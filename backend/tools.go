//go:build tools

// Package tools pins command-line tool dependencies that are not imported by
// the compiled backend. The pinned versions are the reproducible source for
// `go generate ./...` (ISSUE-004).
package tools

import (
	_ "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen"
)
