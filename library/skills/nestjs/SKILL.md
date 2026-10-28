---
name: nestjs
version: "1.0.0"
description: Use when building or reviewing a NestJS application. Covers module structure, dependency injection, guards, pipes, interceptors, exception filters, and database integration. Use when the project has a nest-cli.json or @nestjs/core dependency. Delegates deep NestJS patterns to the external nestjs-best-practices skill. Do not use for non-NestJS backends.
---

# nestjs

Build NestJS applications with clean module boundaries and proper dependency injection. Deep patterns come from the external `nestjs-best-practices` skill.

## Inputs

- The project root. Confirm `@nestjs/core` is in `package.json` dependencies.
- `nest-cli.json` and `src/` directory.

## Rules

1. **One module per feature.** Each feature has its own module with controller, service, and DTOs. No god modules.
2. **Dependency injection.** Use constructor injection. Never instantiate services with `new` outside of factories.
3. **Guards for auth.** Use `@UseGuards()` for authentication and authorization. Never check auth inside a service.
4. **Pipes for validation.** Use `ValidationPipe` with DTOs. Never validate manually in controllers.
5. **Interceptors for cross-cutting.** Logging, caching, and transformation go in interceptors, not services.
6. **Exception filters.** Use global exception filters for consistent error responses. Never catch and rethrow in controllers.
7. **Repository pattern.** Services depend on repository interfaces, not ORM directly. Use TypeORM or Prisma through a repository.
8. **Testing.** Unit test services with mocked repositories. E2E test controllers with a test module.

## Delegation

For deep NestJS patterns (CQRS, microservices, WebSockets, GraphQL, advanced DI), load the external `nestjs-best-practices` skill. It covers 40+ rules with code examples.

## Gotchas

- Circular dependencies between modules: use `forwardRef()` sparingly. Better to restructure.
- `@Global()` modules are for truly cross-cutting concerns (config, database). Do not overuse.
- DTOs must use `class-validator` decorators. Plain interfaces won't trigger validation.
- E2E tests need a separate test database. Never run E2E against production.

## Finish

```yaml
agent: nestjs
job: nestjs guidance for <scope>
status: complete
artifacts: []
findings: []
decisions_owed: []
next: none
```
