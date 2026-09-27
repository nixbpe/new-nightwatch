# Performance Checklist

Quick reference for web performance. Use with skill:`performance-optimization`. The numbers below are common industry reference values, not project targets; the project sets targets in its own contracts.

## Core Web Vitals Reference

| Metric | Good | Needs Work | Poor |
|--------|------|------------|------|
| LCP (Largest Contentful Paint) | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms | > 500ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

## Frontend Checklist

### Images
- [ ] Modern formats (WebP, AVIF), responsive sizes (`srcset`, `sizes`) and explicit `width`/`height`
- [ ] Below-the-fold images use `loading="lazy"`; the LCP image uses `fetchpriority="high"` without lazy loading

### JavaScript
- [ ] Routes and heavy features split with dynamic `import()`; dependencies tree-shakeable
- [ ] `React.memo()`, `useMemo()` and `useCallback()` only where profiling shows benefit
- [ ] Long tasks (> 50ms) broken up with `scheduler.yield()` or a `yieldToMain` pattern, the main lever for INP
- [ ] Non-urgent work (analytics, logging) deferred out of event handlers
- [ ] Third-party scripts loaded `async`/`defer` and audited for size

### CSS and fonts
- [ ] No render-blocking CSS for non-critical styles
- [ ] Few font families and weights, self-hosted WOFF2, subset by `unicode-range`
- [ ] LCP-critical fonts preloaded; `font-display: swap`; fallback metrics adjusted to reduce CLS

### Network and rendering
- [ ] Static assets cached with long `max-age` and content hashes; API responses cached only where safe
- [ ] No unnecessary redirects
- [ ] No layout thrashing; animations use `transform` and `opacity`
- [ ] Long lists virtualized; off-screen sections use `content-visibility: auto`
- [ ] No `unload` handlers and no `Cache-Control: no-store` on HTML, keeping bfcache eligibility

## Backend Checklist

### Database
- [ ] No N+1 queries; list endpoints paginated
- [ ] `EXPLAIN ANALYZE` captured before and after a fix; revert an index that did not change the plan
- [ ] Composite indexes put equality columns first, then range/sort, and cover the query shape
- [ ] Partial, expression or trigram indexes used where the query needs them
- [ ] Write cost of new indexes measured on write-heavy tables; unused and duplicate indexes dropped

### Connection pooling
- [ ] One pool per process; `instances × pool max` stays under `max_connections`
- [ ] Connection timeout set so exhaustion fails fast
- [ ] Exhaustion diagnosed (long transactions, missing `await`, leaked clients) before resizing

### API
- [ ] No synchronous heavy computation in request handlers
- [ ] Bulk operations instead of loops of single calls
- [ ] Responses compressed

## Caching

Caching decisions live in skill:`performance-optimization`; this section covers patterns and the checklist.

| Pattern | How it works | Use when | Watch out for |
|---|---|---|---|
| **Cache-aside** (lazy) | App checks cache, on miss reads origin and populates | Default; read-heavy | Every miss hits the origin, so protect against stampedes |
| **Read-through** | Cache layer loads on miss | One load path instead of one per call site | A slow origin looks like a slow cache |
| **Write-through** | Write goes to cache and origin together | Reads must never be stale after a write | Adds cache latency to every write |
| **Write-behind** | Write hits cache, origin updated later | Write-heavy, origin is the bottleneck | Data loss if the cache dies before the flush |

- [ ] The cached call was measured as expensive first
- [ ] The key includes every input the response varies on: tenant, viewer, locale, permissions, feature flags
- [ ] One invalidation strategy (TTL, event or versioned keys) and a written staleness window
- [ ] Hot keys protected by request coalescing, a lock or `stale-while-revalidate`
- [ ] Negative results cached with a shorter TTL; origin errors never cached
- [ ] Eviction policy and memory ceiling set; hit rate monitored
- [ ] Nothing cached whose staleness is a correctness bug (balances, permissions)

## Measurement

```bash
bun x lighthouse http://localhost:3000 --output json --output-path ./report.json
bun x vite-bundle-visualizer
```

For INP, check real-user data first, then record the slow interaction in the DevTools Performance panel with CPU throttling.
