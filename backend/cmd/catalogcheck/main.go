package main

import (
	"fmt"
	"log"
	"os"

	"obiad/backend/internal/catalogload"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: catalogcheck CATALOG_FILE")
	}
	count, err := catalogload.ValidateFile(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(count)
}
