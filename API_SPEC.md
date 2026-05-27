# API_SPEC

## API Scope
- Service boundary:
- Data owners:

## Quality Bar
- Target: stable v1 contract for selected flows, not a temporary MVP API.
- Compatibility: breaking changes require a recorded decision and migration/transition plan.
- Operability: errors, validation, observability, and retry behavior must be explicit for included endpoints.

## Authentication and Authorization
- Auth method:
- Token/session lifetime:
- Role model:

## Endpoints
| Method | Path | Purpose | Request | Response | Error Codes |
|---|---|---|---|---|---|
| GET | /health | health check | - | { ok: true } | 500 |

## Error Model
- Canonical error shape:
- Validation error shape:
- Retryable vs non-retryable errors:

## Versioning
- Strategy:
- Backward compatibility policy:

## Product API Priorities
- 一時的なMVP APIではなく、選択フローの安定契約として扱う
- 契約（request/response/error）を明確化
- 監視・運用を考慮したエラー分類とバージョニングを維持

