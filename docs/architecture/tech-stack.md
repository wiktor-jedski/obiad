# System Design

## Tech Stack

### Frontend

Web framework: Svelte
Build tool: Bun
State management: Svelte stores + TanStack Query
CSS: Tailwind
Testing: Bun test runner + @testing-library/svelte + Playwright
Caching: Service Worker + localStorage

### Backend

Language: Go
Framework: Fiber
Query builder: raw SQL
Internal API: Direct function calls
Cosine Similarity: Custom implementation
API Documentation: OpenAPI
Testing: testing package (built-in)
Database: PostgreSQL
Session management: Fiber session middleware
Logging: Fiber logger middleware

### Data Layer

Database: PostgreSQL
PostgreSQL driver: lib/pq or pgx

### External Services

Food data: USDA FoodData Central, OpenFoodFacts
CI/CD: GitHub Actions

### Security

Rate limiting: Fiber built-in limiter
CSRF: Fiber csrf middleware

### Operational

Container orchestration: Not needed (managed services)
