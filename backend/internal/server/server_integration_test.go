package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/testdb"
)

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("go.mod not found above %s", dir)
		}
		dir = parent
	}
}

func runDBSetupCommand(t *testing.T, dbURL string) string {
	t.Helper()
	cmd := exec.Command("go", "-C", moduleRoot(t), "run", "./cmd/dbsetup")
	cmd.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+dbURL)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go run ./cmd/dbsetup failed: %v\noutput:\n%s", err, out)
	}
	return string(out)
}

func connect(t *testing.T, dbURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", redactedURL(dbURL), err)
	}
	t.Cleanup(func() {
		if err := conn.Close(context.Background()); err != nil {
			t.Errorf("close database connection: %v", err)
		}
	})
	return conn
}

func redactedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<invalid database URL>"
	}
	u.User = nil
	return u.String()
}

func newSetupDB(t *testing.T) *testdb.DB {
	t.Helper()
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	return db
}

func startServer(t *testing.T, runtimeURL string) (baseURL string, pool *pgxpool.Pool) {
	t.Helper()
	return startServerWithLogger(t, runtimeURL, slog.New(slog.DiscardHandler))
}

func startServerWithLogger(t *testing.T, runtimeURL string, logger *slog.Logger, register ...func(*fiber.App)) (baseURL string, pool *pgxpool.Pool) {
	t.Helper()
	app, pool, err := Compose(runtimeURL, logger)
	if err != nil {
		t.Fatalf("compose server: %v", err)
	}
	for _, fn := range register {
		fn(app)
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		pool.Close()
		t.Fatalf("listen on 127.0.0.1:0: %v", err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- app.Listener(ln) }()
	t.Cleanup(func() {
		if err := app.Shutdown(); err != nil {
			t.Errorf("shutdown server: %v", err)
		}
		pool.Close()
		select {
		case err := <-serveErr:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				t.Errorf("serve: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("server did not stop after shutdown")
		}
	})
	return "http://" + ln.Addr().String(), pool
}

func getHealth(t *testing.T, baseURL string) (status int, body string, contentType string) {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close /health response body: %v", err)
		}
	}()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read /health body: %v", err)
	}
	return resp.StatusCode, string(raw), resp.Header.Get("Content-Type")
}

func assertExactHealthResponse(t *testing.T, status int, body string, contentType string, wantStatus string) {
	t.Helper()
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type %q, want application/json", contentType)
	}
	want := fmt.Sprintf(`{"status":%q}`, wantStatus)
	if body != want {
		t.Fatalf("body %q, want exactly %q (no dependency details)", body, want)
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("body %q is not valid JSON: %v", body, err)
	}
	if len(parsed) != 1 || string(parsed["status"]) != strconv.Quote(wantStatus) {
		t.Fatalf("body %q has fields %v, want exactly {\"status\":%q}", body, parsed, wantStatus)
	}
}

func adminDatabaseURL() string {
	if u := os.Getenv("OBIAD_TEST_ADMIN_DATABASE_URL"); u != "" {
		return u
	}
	host := os.Getenv("PGHOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("PGPORT")
	if port == "" {
		port = "5432"
	}
	user := os.Getenv("PGUSER")
	if user == "" {
		user = "postgres"
	}
	db := os.Getenv("PGDATABASE")
	if db == "" {
		db = "postgres"
	}
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(host, port), Path: "/" + db}
	u.User = url.User(user)
	return u.String()
}

func isSQLIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		lower := r >= 'a' && r <= 'z'
		digit := r >= '0' && r <= '9'
		underscore := r == '_'
		if i == 0 && !lower && !underscore {
			return false
		}
		if !lower && !digit && !underscore {
			return false
		}
	}
	return true
}

func databaseName(t *testing.T, dbURL string) string {
	t.Helper()
	u, err := url.Parse(dbURL)
	if err != nil {
		t.Fatalf("parse %s: %v", redactedURL(dbURL), err)
	}
	name := strings.TrimPrefix(u.Path, "/")
	if !isSQLIdentifier(name) {
		t.Fatalf("refusing to drop database %q (not a generated identifier)", name)
	}
	return name
}

func TestHealthHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	status, body, contentType := getHealth(t, baseURL)
	if status != http.StatusOK {
		t.Fatalf("GET /health status %d, want 200", status)
	}
	assertExactHealthResponse(t, status, body, contentType, "ready")

	adminConn := connect(t, adminDatabaseURL())
	if _, err := adminConn.Exec(context.Background(), "DROP DATABASE "+databaseName(t, db.RuntimeURL)+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop disposable database: %v", err)
	}

	for i := 0; i < 2; i++ {
		status, body, contentType := getHealth(t, baseURL)
		if status != http.StatusServiceUnavailable {
			t.Fatalf("GET /health after database drop: status %d, want 503", status)
		}
		assertExactHealthResponse(t, status, body, contentType, "unavailable")
	}
}

func TestServerRuntimeConstraints(t *testing.T) {
	db := newSetupDB(t)
	baseURL, pool := startServer(t, db.RuntimeURL)

	if got := pool.Config().MinConns; got != 0 {
		t.Fatalf("pool MinConns = %d, want 0", got)
	}
	if got := pool.Config().MaxConns; got != 4 {
		t.Fatalf("pool MaxConns = %d, want 4", got)
	}

	runtimeURL, err := url.Parse(db.RuntimeURL)
	if err != nil {
		t.Fatalf("parse runtime URL: %v", err)
	}
	cc := pool.Config().ConnConfig
	if cc.Database != strings.TrimPrefix(runtimeURL.Path, "/") {
		t.Fatalf("pool database %q, want %q from the runtime URL", cc.Database, strings.TrimPrefix(runtimeURL.Path, "/"))
	}
	if cc.User != runtimeURL.User.Username() {
		t.Fatalf("pool user %q, want %q from the runtime URL", cc.User, runtimeURL.User.Username())
	}
	runtimePassword, _ := runtimeURL.User.Password()
	if cc.Password != runtimePassword {
		t.Fatal("pool password does not match the runtime URL credential")
	}
	if cc.Host != runtimeURL.Hostname() {
		t.Fatalf("pool host %q, want %q from the runtime URL", cc.Host, runtimeURL.Hostname())
	}
	wantPort, err := strconv.Atoi(runtimeURL.Port())
	if err != nil {
		t.Fatalf("runtime URL port %q: %v", runtimeURL.Port(), err)
	}
	if int(cc.Port) != wantPort {
		t.Fatalf("pool port %d, want %d from the runtime URL", cc.Port, wantPort)
	}

	addrHost, addrPort, err := net.SplitHostPort(DefaultListenAddr)
	if err != nil {
		t.Fatalf("DefaultListenAddr %q: %v", DefaultListenAddr, err)
	}
	if ip := net.ParseIP(addrHost); ip == nil || !ip.IsLoopback() {
		t.Fatalf("DefaultListenAddr host %q is not loopback", addrHost)
	}
	if addrPort != "8080" {
		t.Fatalf("DefaultListenAddr port %q, want 8080", addrPort)
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse server base URL %q: %v", baseURL, err)
	}
	if ip := net.ParseIP(base.Hostname()); ip == nil || !ip.IsLoopback() {
		t.Fatalf("actual listener address %q is not loopback", base.Hostname())
	}

	status, body, contentType := getHealth(t, baseURL)
	if status != http.StatusOK {
		t.Fatalf("GET /health status %d, want 200", status)
	}
	assertExactHealthResponse(t, status, body, contentType, "ready")
}
