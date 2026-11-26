// Package dbbootstrap installs deployment roles and catalog privileges.
package dbbootstrap

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	sqlfiles "obiad/backend/internal/repository/sql"
)

// Target identifies the database and its two login roles.
type Target struct {
	Database string
	Owner    string
	Runtime  string
}

// Apply installs roles before migration or grants SELECT after catalog import.
func (d Target) Apply(ctx context.Context, admin *pgx.ConnConfig, phase, ownerPassword, runtimePassword string) error {
	if phase != "roles" && phase != "grants" {
		return errors.New("usage: dbbootstrap roles|grants")
	}
	if ownerPassword == "" || runtimePassword == "" {
		return errors.New("set OBIAD_OWNER_PASSWORD and OBIAD_RUNTIME_PASSWORD")
	}
	config := admin.Copy()
	config.RuntimeParams["search_path"] = "pg_catalog"
	control, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return failure("connect to admin database", err)
	}
	defer control.Close(context.WithoutCancel(ctx)) //nolint:errcheck
	var exists, runtimeOwns bool
	if err := control.QueryRow(ctx, sqlfiles.BootstrapPreflight, d.Database, d.Runtime).Scan(&exists, &runtimeOwns); err != nil {
		return failure("check runtime ownership", err)
	}
	if runtimeOwns {
		return errors.New("runtime role owns objects in the target database; reassign ownership before setup")
	}

	identifiers := strings.NewReplacer(
		`"__OBIAD_DATABASE__"`, pgx.Identifier{d.Database}.Sanitize(),
		`"__OBIAD_OWNER_USER__"`, pgx.Identifier{d.Owner}.Sanitize(),
		`"__OBIAD_RUNTIME_USER__"`, pgx.Identifier{d.Runtime}.Sanitize(),
	)
	config.Database = d.Database
	privileges := sqlfiles.RemovePublicPrivileges
	if phase == "roles" {
		if _, err := control.Exec(ctx, sqlfiles.BootstrapRoleFunction); err != nil {
			return failure("prepare role setup", err)
		}
		if _, err := control.Exec(ctx, sqlfiles.BootstrapRoles, pgx.QueryExecModeExec, d.Owner, ownerPassword, d.Runtime, runtimePassword); err != nil {
			return failure("set role attributes and memberships", err)
		}
		ddl := sqlfiles.CreateDatabase
		if exists {
			ddl = sqlfiles.SetDatabaseOwner
		}
		if _, err := control.Exec(ctx, identifiers.Replace(ddl)); err != nil {
			return failure("set up target database", err)
		}
	} else {
		config.User, config.Password = d.Owner, ownerPassword
		config.RuntimeParams["search_path"] = "pg_catalog, public"
		privileges = sqlfiles.RuntimeCatalogRead
	}
	target, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return failure("connect to target database", err)
	}
	defer target.Close(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := target.Exec(ctx, identifiers.Replace(privileges)); err != nil {
		return failure("set target database privileges", err)
	}
	return nil
}

// Keep credentials, SQL text, and server error details out of diagnostics.
func failure(step string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return fmt.Errorf("%s: SQLSTATE %s", step, pgErr.Code)
	}
	return errors.New(step + " failed")
}
