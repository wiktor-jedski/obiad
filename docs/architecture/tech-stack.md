# POC System Design

## Tech Stack

### Frontend

Web framework: Svelte 5
Build tool: Bun
State management: Svelte stores + TanStack Query
CSS: Tailwind
Testing: Bun + @testing-library/svelte for component integration; Playwright for browser integration and visual checks
Client persistence: localStorage for the selected interface language

### Backend

Language: Go
Framework: Fiber
Database queries: raw SQL
Internal API: Direct function calls
Cosine Similarity: Custom implementation
API Documentation: OpenAPI
Testing: testing package (built-in)
Database: PostgreSQL
Logging: Fiber logger middleware

### Data Layer

Database: PostgreSQL
PostgreSQL driver: pgx
Food data: deterministic seed SQL
Food images: bundled assets with a shared placeholder

### Project Services

CI/CD: GitHub Actions


### Operational

Deployment: local frontend, backend, and PostgreSQL processes
