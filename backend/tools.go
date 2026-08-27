//go:build tools

// Package tools pins command-line tool dependencies.
// The versions support reproducible code generation.
package tools

import (
	_ "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen"
)
