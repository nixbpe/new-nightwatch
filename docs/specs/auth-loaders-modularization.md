# แยก auth loaders โดยคงพฤติกรรมเดิม

## สถานะและขอบเขตอำนาจ

สถานะ `Implemented`. ผล static spec review คือ `ready for implementation design`. Source และ tests ผ่าน independent static review แล้ว แต่ global validation ยังไม่ครบตามข้อจำกัดด้านล่าง.

เอกสารนี้สร้างตามคำขอให้เขียน spec และรีวิวก่อนแก้โค้ด เป็นข้อกำหนดสำหรับการแยก `apps/web/src/lib/auth/loaders.ts` เท่านั้น คำขอถัดมาอนุญาต implementation ตาม spec นี้แล้ว ยังไม่อนุญาต commit, push หรือ release.

Baseline คือ commit `6421b0676b4c775c0747e69518dc601b8b1734b2`. ไฟล์ต้นทางมี 800 physical lines รวม comments และบรรทัดว่าง มี exported functions 19 ตัว และ private named functions 6 ตัว ไม่นับ callback ภายในฟังก์ชัน ตัวเลขนี้เป็นผลสำรวจ source ไม่ใช่ผล runtime verification.

## เป้าหมาย

- แยก implementation ตามกลุ่ม route ให้ production files ในชุดนี้มีไม่เกิน 500 physical lines ต่อไฟล์หลัง formatter.
- คง public imports, signatures, redirects, request behavior และ query-cache effects เดิม.
- ให้ผู้ดูแลเปิดอ่าน loader ของ domain ที่เกี่ยวข้องโดยไม่ต้องอ่านทุก domain.

ไม่อ้างว่าการแยกไฟล์ลด tokens รวม หรือเพิ่มความแม่นยำของ agent เพราะยังไม่มีการวัดผลดังกล่าว.

## แหล่งอ้างอิง

- [Source loaders](../../apps/web/src/lib/auth/loaders.ts), [router](../../apps/web/src/router.tsx) และ [loader tests](../../apps/web/src/lib/auth/loaders.test.tsx).
- [Architecture](../architecture.md#web-app) เป็นเจ้าของกติกา identity isolation และ loader/page cache sharing ตาม WEB-03 และ WEB-04.
- [Query client](../../apps/web/src/lib/queryClient.ts), [bootstrap](../../apps/web/src/lib/tenant/bootstrap.ts), [session provider](../../apps/web/src/lib/auth/SessionQueryProvider.tsx) และ [last-project save barrier](../../apps/web/src/lib/lastProjectSave.ts) เป็นเจ้าของ shared state เดิม.
- [Quality check routing](../../scripts/quality/README.md#check-routing) เป็นเจ้าของข้อกำหนดการตรวจสอบ ไม่ลด gates หรือ coverage thresholds จากเอกสารนั้น.

เลขบรรทัดในเอกสารนี้อ้าง baseline ก่อนแยกไฟล์ อ่าน baseline ได้ด้วย `git show 6421b06:apps/web/src/lib/auth/loaders.ts`.

## ขอบเขตการแก้ไข

| การเปลี่ยน | ไฟล์ |
| --- | --- |
| เปลี่ยนเป็น facade | `apps/web/src/lib/auth/loaders.ts` |
| เพิ่ม implementation modules | เก้าไฟล์ใน `apps/web/src/lib/auth/loaders/` ตามตารางด้านล่าง |
| เสริม assertion ที่มีอยู่ | `apps/web/src/lib/auth/loaders.test.tsx` เฉพาะกรณี Edit ต้องอ่านสดจาก cached Detail |
| เพิ่ม characterization ของ sessions loader | `apps/web/src/lib/auth/loaders-settings.test.ts` |

คง `loaders.test.tsx` ที่มี 2,339 บรรทัดเป็น regression suite เดิมในงานนี้ การแยก test file เป็นอีกงานหนึ่ง ไม่เปลี่ยน mock ownership หรือ test discovery พร้อมกับย้าย production modules.

ไม่แก้ router bindings, `projectsShouldRevalidate`, pages, API contracts, generated output, dependencies, lockfiles, migrations, query keys, query-client registry, bootstrap protocol, session provider หรือ save barrier. ไม่เพิ่ม generic loader factory, `ensureTenant`, `utils.ts`, context registry หรือ cached session ใหม่.

ไม่เพิ่มกฎ 500 บรรทัดทั่ว repository ในงานนี้ หาก source กับ baseline ไม่ตรง ให้ทบทวนส่วนที่เปลี่ยนก่อนย้าย ห้ามใช้ spec นี้ทับงานของผู้อื่น.

## โครงสร้างที่กำหนด

ใช้โฟลเดอร์ `lib/auth/loaders/` ข้าง facade เดิม ไม่ย้าย routing ทั้งระบบไป namespace ใหม่หรือ page folders.

| ไฟล์ภายใต้ `apps/web/src/lib/auth/` | เจ้าของเนื้อหา | บรรทัดที่ประมาณการหลังแยก |
| --- | --- | --- |
| `loaders.ts` | explicit named re-exports ของ loader เดิม 19 ตัว | 25 ถึง 40 |
| `loaders/session.ts` | `Session`, `loadSession`, `gateVerifiedSession`, `prefetchMeContext` | 90 ถึง 105 |
| `loaders/entry.ts` | `rootLoader`, `requireAnonLoader`, `verifyEmailLoader` | 65 ถึง 85 |
| `loaders/settings.ts` | `settingsIndexLoader`, `settingsLoader`, `sessionsLoader` | 65 ถึง 85 |
| `loaders/workspace.ts` | `workspaceLoader` รวม landing loop และ `isCurrent` | 95 ถึง 120 |
| `loaders/notifications.ts` | `notificationsLoader`, `notificationSettingsLoader` | 70 ถึง 90 |
| `loaders/projects.ts` | `projectsLoader`, `projectOverviewLoader`, `projectMembersLoader` | 150 ถึง 175 |
| `loaders/monitors.ts` | `monitorsOverviewLoader`, `monitorDetailLoader`, `monitorCreateLoader`, `monitorEditLoader` | 175 ถึง 205 |
| `loaders/auditLog.ts` | `auditLogLoader`, `auditLogEventLoader`, private `resolveAuditReader` | 150 ถึง 180 |
| `loaders/organizationMembers.ts` | `organizationMembersLoader`, private `hasSameMembershipScope` และ `isNavigationAborted` | 220 ถึง 250 |

ตัวเลขเป็นประมาณการรวม imports, types, comments และ formatting ไม่ใช่ผลตรวจผ่าน เกณฑ์บังคับคือไม่เกิน 500 ไม่ใช่ต้องเขียนให้ถึงงบประมาณ.

### Dependency direction

`router` และ consumers เดิม import จาก `auth/loaders.ts`. Facade re-export จาก implementation modules โดยตรง ไม่มี wrapper ที่เรียก loader อีกทอด และไม่ใช้ `export *`.

Domain modules import helpers จาก `./session` และ import API/query/cache modules เดิมโดยตรง ห้าม import กลับผ่าน facade หรือเรียก loader ของ domain อื่น ไม่สร้าง barrel ภายในโฟลเดอร์เพิ่ม.

`session.ts` ไม่ import facade หรือ domain modules. สาม helper ที่ใช้ข้ามไฟล์เป็น internal exports ของ `session.ts` เท่านั้น ไม่หลุดผ่าน public facade. `Session` ยังคง derive จาก `typeof authClient.$Infer.Session` ไม่สร้าง DTO ใหม่.

`queryClient.ts`, `tenant/bootstrap.ts`, `SessionQueryProvider.tsx` และ `lastProjectSave.ts` คงเป็นเจ้าของ registry, publication, lifecycle และ save ordering เดิม. ไม่มี module-level client/context instance เพิ่มใน modules ใหม่.

## Public contracts ที่ต้องคง

`rootLoader` และ `settingsIndexLoader` คืน `Response` แบบ synchronous. `sessionsLoader` และ `verifyEmailLoader` คืน `Promise<null>`. Public functions อีก 15 ตัวคืน `Promise<null | Response>`. คง arguments และ explicit return types เดิม ไม่เปลี่ยน returned redirect เป็น thrown redirect หรือคืน API payload แทน `null`.

| Export | บรรทัดเริ่มต้น | พฤติกรรมที่ต้องรักษา |
| --- | ---: | --- |
| `rootLoader` | 86 | replace ไป `/workspace` โดยไม่อ่าน session |
| `requireAnonLoader` | 90 | anonymous คืน null ส่วน signed-in อ่าน post-auth destination แล้ว clear return-to ก่อน replace ไม่เพิ่ม verified gate |
| `workspaceLoader` | 149 | เลือก organization ตาม server lastActiveTenantId และใช้ last-project save protocol ตามหัวข้อถัดไป |
| `notificationsLoader` | 212 | context ต้องสำเร็จก่อนเลือก scope ถ้าไม่มี selected organization ใช้ account scope null ถ้า context ล้มเหลวไม่ fetch inbox |
| `notificationSettingsLoader` | 232 | ต้องมี organizationId และ membership ไม่เพิ่ม role gate ใน loader |
| `monitorsOverviewLoader` | 260 | ต้องมี org/project และ membership ใช้ first-page list limit เดิมและ offset 0 |
| `projectOverviewLoader` | 291 | prefetch monitor list และ recent events คู่ขนาน โดย catch แยกแต่ละ query |
| `projectsLoader` | 328 | ต้องมี org/membership และ prefetch project list ทั้งชุด |
| `projectMembersLoader` | 360 | prefetch project detail และ members คู่ขนาน โดย catch ที่ Promise.all เดิม |
| `monitorDetailLoader` | 398 | ต้องมี org/project/monitor และ membership ให้ page แสดง not-found/error เอง |
| `auditLogLoader` | 454 | เฉพาะ owner/admin/auditor ใช้ URL filters, preferences timezone, floor-to-minute และ retainedFrom เดิม range ผิดงดเฉพาะ events list แต่ยัง prefetch actors |
| `auditLogEventLoader` | 512 | reader gate เดียวกับ audit list ต้องมี eventId และให้ page แสดง not-found เอง |
| `monitorCreateLoader` | 537 | warm context เท่านั้น ไม่เพิ่ม params/membership/role gate และไม่ fetch monitor |
| `monitorEditLoader` | 550 | params/membership เหมือน Detail แต่ต้องอ่าน version ใหม่ตาม query options เดิม |
| `organizationMembersLoader` | 591 | direct fresh context publication และ directory protocol ตามหัวข้อถัดไป ไม่แทนด้วย generic prefetch |
| `settingsIndexLoader` | 754 | replace ไป `/settings/profile` |
| `sessionsLoader` | 759 | ไม่มี session หรือ unverified คืน null ไม่ redirect เพราะรันขนาน parent settingsLoader |
| `settingsLoader` | 774 | verified gate แล้ว warm context ไม่คืน context payload |
| `verifyEmailLoader` | 785 | anonymous ที่มี remembered invitation จึง warm preview ใน anonymous client ผู้ที่ signed-in ไม่ fetch preview |

### Session, context และ query options

- `loadSession` ถาม server ผ่าน `authClient.getSession()` auth error หรือ throw คืน null ไม่เปลี่ยนไปอ่าน cached browser atom.
- `gateVerifiedSession` คง login `from` ที่รวม pathname และ search คง `/verify-email` สำหรับ unverified และใช้ `redirectDocument(request.url)` เมื่อ active identity ที่ทราบแล้วไม่ตรงกับ session. ค่า undefined กับ anonymous null มีความหมายต่างกัน.
- `prefetchMeContext` ใช้ identity-bound client และ `contextQueryOptions` ที่ staleTime 0. Failure คืน undefined. ห้ามถือ cached context เป็น fresh admission หรือ fallback account inbox เมื่อ resolution ล้มเหลว.
- คง endpoint `POST /api/me/resolve-active-org` ผ่าน `fetchMeContext` เดิม ไม่แทนด้วย read-only context endpoint.
- คง query keys และรูปข้อมูล API เดิมทั้งหมด.

| Query กลุ่ม | staleTime | Retry |
| --- | --- | --- |
| shared context resolution | 0 | false ผ่าน contextQueryOptions |
| workspace last-project | 0 | false |
| monitor Edit | 0 | false |
| audit list/event/actors และ invitation preview | static | false |
| inbox/settings, project/monitor reads อื่น และ sessions | static | สืบทอด QueryClient default เดิม |
| organization directory | ตรวจ freshness ผ่าน defaultQueryOptions และ isStaleByTime | direct fetch ตามเดิม ไม่มี query retry wrapper |

`static` ในตารางหมายถึง literal `"static"` ไม่แทนด้วย `Infinity`. คงตำแหน่ง catch และ Promise.all เดิม การเปลี่ยน catch ของ projectMembersLoader เป็นราย query อาจเปลี่ยนเวลาที่ route พร้อมแสดงผล.

## Protocol ที่ต้องย้ายทั้งก้อน

### Workspace landing

อ้าง baseline `loaders.ts:149-210`.

1. ผ่าน verified gate แล้ว resolve identity client.
2. ให้ `isCurrent` อ่าน request abort, retired admission และ active identity สดตามจุดเดิมก่อนและหลัง awaits ไม่เก็บผลเป็น boolean ข้าม await.
3. resolve context และเลือกเฉพาะ organization ที่ตรง lastActiveTenantId.
4. วนรอ pending saves แล้วตรวจ current ก่อน cancel exact last-project query.
5. รอ saves อีกครั้งและตรวจ current แล้วเก็บ landing revision.
6. fetch last-project ด้วย staleTime 0, retry false และ queryFn signal เดิม.
7. ถ้าหมดอายุหรือผลล้มเหลวคืน null ถ้าได้ผลแต่ revision เปลี่ยนให้วนใหม่ มิฉะนั้นจึง replace ปลายทางเดิม.

คงทั้งสอง save barriers. Barrier ที่สองครอบคลุม save ที่เข้าระหว่าง cancel ส่วน revision ครอบคลุม save ที่เกิดระหว่าง GET. ไม่ใช้ cached Project เป็น fallback และไม่ย้าย WeakMap/revision owner ออกจาก lastProjectSave.ts.

### Organization member publication

อ้าง baseline `loaders.ts:591-752`.

1. สร้าง claim ordinal ก่อน await session. หลังผ่าน gate, abort และ params checks จึง resolve client และ claim ownership ด้วย intent bootstrap.
2. อ่าน previousContext แล้วคง abort/ownership checks ก่อนและหลัง cancel exact me/context query และ tenant queries.
3. เรียก fetchMeContext โดยตรงและ assert response identity ไม่ join context query เก่า. คงการตรวจ abort/claim ก่อนจัดการผล.
4. ถ้า fetch/assert fail และยังเป็นเจ้าของ ให้ fail publication, remove exact context และ cancel/remove tenant cache ตามลำดับและ guards เดิม แล้วคืน null. ผลเก่าหรือ aborted ห้ามล้าง cache ปลายทาง. ไม่เปลี่ยน failed publication เป็น retired lifecycle.
5. ถ้า membership scope เปลี่ยน ให้ cancel/remove tenant ก่อน publish ตามเดิม. hasSameMembershipScope ยังเทียบ selected tenant และชุด org id/role ไม่แทนด้วย contextScopeChanged.
6. publish context ก่อน directory request. คง guard หลัง publication เพราะ listeners อาจเปลี่ยน ownership ระหว่าง publication ได้.
7. เฉพาะ owner/admin จึงตรวจ exact member key 50/0. ใช้ staleTime จาก defaultQueryOptions ซึ่งอาจเป็น function แล้วตรวจ isStaleByTime. Fresh page ใช้ของเดิม ส่วน missing/stale page fetch โดยตรงและตรวจ abort/claim ก่อน setQueryData. Failure ไม่เขียน undefined ทับ cache.

คง guard ที่ซ้ำติดกันก่อน publish ในรอบย้ายไฟล์ ไม่รวม cleanup หรือ protocol redesign. Request abort checks ป้องกัน publication/cache effects ตามตำแหน่งเดิม ไม่อ้างว่ายกเลิก network calls ทุกตัว เพราะ direct context/member fetch ยังไม่ได้รับ request.signal.

## งานและหลักฐานต่อขั้น

ทุกขั้นเป็นส่วนของ change เดียว ไม่ได้กำหนดหลาย PR หรืออนุญาต publication. หาก focused baseline fail ให้บันทึกว่าเป็น failure ก่อนแก้และแยกสาเหตุ ห้ามลด guards หรือ assertions เพื่อให้ผ่าน.

| งาน | ไฟล์ที่เป็นเจ้าของ | หลักฐานก่อนทำขั้นต่อไป |
| --- | --- | --- |
| 1. เก็บ baseline และเสริม characterization | loader tests เดิม และ loaders-settings.test.ts ใหม่ | public exports/signatures เดิมครบ และ focused tests ที่เพิ่มผ่านก่อนย้าย implementation |
| 2. แยก session, entry และ settings | facade และสาม modules นี้ | loader/settings tests และ Web typecheck ผ่าน |
| 3. ย้าย notifications, projects และ monitors | facade และสาม domain modules นี้ | loader suite และ router suite ผ่าน ตรวจ diff ของ keys/options/params/catch |
| 4. ย้าย audit พร้อม reader helper | facade และ auditLog.ts | audit cases รวม invalid range และ loader/page single-fetch ผ่าน |
| 5. ย้าย workspace loop | facade และ workspace.ts | workspace cases และ last Project save barrier suite ผ่าน |
| 6. ย้าย organization member protocol | facade และ organizationMembers.ts | fresh-membership, bootstrap identity/barrier และ provider/identity suites ผ่าน |
| 7. ตรวจ final candidate | source และ tests ในขอบเขตที่กำหนด | final verification ด้านล่างครบ และ facade เหลือ explicit exports เท่านั้น |

ย้าย whole functions พร้อม owning types และ imports. ลบเฉพาะ imports ที่งานนี้ทำให้ไม่ใช้ ไม่แก้ pre-existing dead code. ไม่เพิ่ม behavior comments ที่อ้าง AC หรือ Feature IDs กลับเข้า source.

## Verification ที่กำหนด

### Characterization ที่เพิ่มในงานนี้

- เสริม Edit test ที่ `loaders.test.tsx:1382` ให้ seed cached Detail version เก่าที่ query key จริงใน identity client เดียวกับ loader. จัด context scope ให้ไม่เปลี่ยนระหว่าง context preparation และยืนยันว่า cached version เก่ายังอยู่ก่อน detail query โดยใช้ real context helper เดิม. จากนั้น assert ว่าเรียก API และ cache ลงท้ายด้วย fresh version. Body เดิมยังไม่ได้ seed cache แม้ชื่อ test กล่าวถึง cached poll.
- เพิ่ม public sessionsLoader tests ใน loaders-settings.test.ts. ตรวจ anonymous/unverified คืน null และไม่เรียก API ตรวจ verified ส่งข้อมูลลง identity client ที่ถูกต้อง และตรวจ failed fetch คืน null ไม่โยน router error. ใช้ expected payload/key/result ที่กำหนดอิสระ ไม่ assert เพียงว่า helper ถูกเรียก.
- เก็บ settings index assertion เดิมใน SettingsLayout.test.tsx ที่ตรวจ `/settings` ไป `/settings/profile` ไม่เพิ่มซ้ำ.

Characterization ต้องแยกความผิดพลาดที่สำคัญได้. Edit case ต้อง fail เมื่อ freshness ถูกเปลี่ยนเป็น static และ sessions cases ต้อง fail เมื่อเอา session gate ออก เปลี่ยนเป็น redirect หรือเขียน cache ผิด identity. บันทึกผล fault check ตอน implementation ไม่ถือว่าข้อเสนอนี้เป็นผลรันแล้ว.

### Existing regression suites

| ไฟล์ภายใต้ `apps/web/src/` | สิ่งที่ตรวจ |
| --- | --- |
| `lib/auth/loaders.test.tsx` | anonymous/protected gates, prefetch, domain scopes, workspace/save races, organization publication และ cross-loader bootstrap |
| `lib/auth/identityLifecycle.test.tsx` | old/new identity isolation, document reload และ same-identity navigation |
| `lib/auth/SessionQueryProvider.test.tsx` | staged adoption และ identity boundaries |
| `lib/lastProjectSave.test.ts` | pending/failed/concurrent saves, revision และ abort |
| `lib/tenant/TenantProvider.test.tsx` | loader publication และ provider cache ownership |
| `router.test.tsx` | Projects route revalidation configuration |
| `pages/settings/SettingsLayout.test.tsx` | settings index redirect และ layout integration |
| `pages/monitors/MonitorFormFocus.test.tsx` | Create/Edit loader integration กับ admission และ focus |
| `pages/LoginPage.test.tsx`, `pages/AcceptInvitationPage.test.tsx` | anonymous gate consumers และ auth continuation |

Router revalidation tests บางกรณีแทน loader ด้วย spy จึงไม่ใช้เป็นหลักฐานแทน loader behavior tests.

### คำสั่งตอน implementation

คำสั่งเหล่านี้ยังไม่ได้รันจากการเขียน spec. ใช้ focused filters ตามงานย่อย แล้วรันทั้งชุดเมื่อจบ.

```sh
bun run --cwd apps/web test src/lib/auth/loaders.test.tsx src/lib/auth/loaders-settings.test.ts src/lib/auth/identityLifecycle.test.tsx src/lib/auth/SessionQueryProvider.test.tsx src/lib/lastProjectSave.test.ts src/lib/tenant/TenantProvider.test.tsx src/router.test.tsx src/pages/settings/SettingsLayout.test.tsx src/pages/monitors/MonitorFormFocus.test.tsx src/pages/LoginPage.test.tsx src/pages/AcceptInvitationPage.test.tsx
bun run --cwd apps/web typecheck
bun run --cwd apps/web lint
COVERAGE_GATE=1 bun run --cwd apps/web test:coverage
bun run --cwd apps/web build
bun run format:check
wc -l apps/web/src/lib/auth/loaders.ts apps/web/src/lib/auth/loaders/*.ts
```

Full Web suite ต้องรันพร้อม coverage gate และเก็บ coverage report ของ final candidate รวม modules ใหม่และ sessions tests. คง coverage scope และ thresholds ของ apps/web/vitest.config.ts เดิม ไม่ใช้ focused test pass แทน full coverage evidence.

บันทึกผลผ่าน ล้มเหลว หรือไม่ได้รันตามจริง. ตรวจชื่อ exports/signatures ก่อนกับหลัง ตรวจ function bodies และ import bindings ว่าเป็น move-only change และตรวจ dependency direction. ไม่ใช้ byte-identical emitted modules เป็นเกณฑ์ เพราะ module graph และ imports เปลี่ยน.

## เกณฑ์รับ implementation

- [x] Production facade และเก้า implementation modules มีไม่เกิน 500 physical lines หลัง formatter. ตรวจแต่ละไฟล์ ไม่ใช้ total ของ wc เป็นเกณฑ์.
- [x] Public exports ทั้ง 19 ชื่อ, arguments, return types และ returned redirect semantics ตรง baseline. Internal session helpers ไม่ถูก re-export ผ่าน facade.
- [x] Router bindings และ revalidation configuration เดิมไม่เปลี่ยน.
- [x] Query keys, endpoint/payload, staleTime, retry, catches และ request parallelism เดิมไม่เปลี่ยน.
- [x] Identity-bound cache, context publication ordering และ workspace save barriers ผ่าน focused behavioral assertions.
- [x] Characterization ของ Edit และ sessions แยก faults ที่กำหนดได้ และไม่มีการลด tests/coverage thresholds เดิม.
- [x] Full Web coverage gate ผ่านและเก็บ report ที่ตรง final candidate โดยใช้ coverage scope และ thresholds เดิม. Command exit 0 พร้อมคำเตือนเรื่อง versions ตามข้อจำกัดด้านล่าง.
- [x] Imports ไม่มีวงจร ไม่มี domain loader เรียก loader อื่น และไม่มี shared-state owner เพิ่ม.
- [ ] Final commands และ checks ที่เกี่ยวข้องตาม quality routing มีหลักฐานจริง หรือระบุ blocker ที่ยังไม่ผ่าน. Targeted pass อย่างเดียวไม่ใช่ full validation.

## การทบทวน spec

Independent review รอบแรกให้ผล `changes requested`. พบ Major 1 รายการเกี่ยวกับการขาด coverage execution/report และไม่มี Blocker.

เพิ่ม full Web coverage gate และข้อกำหนดเก็บ report แล้ว พร้อมระบุ precondition ของ cached Edit characterization ตามข้อเสนอเสริม.

Delta review ให้ผล `ready for implementation design`. Major 1 ปิดแล้วและไม่มี finding คงค้างในระดับ spec. ผลนี้ครอบคลุม static review ของเอกสารและ source/config ที่อ้างอิง ไม่ใช่ผลรัน implementation หรือ tests.

การตรวจเอกสารไม่ใช่ implementation verification. การอนุญาต implementation มาจากคำขอของผู้ใช้ภายหลัง ไม่ใช่ผลรีวิวเอกสาร และไม่อนุญาต release.

## ผล implementation และข้อจำกัด

แยก facade เหลือ 35 บรรทัดและ implementation เก้าไฟล์ตามแผน ไฟล์ที่ยาวที่สุดคือ organizationMembers.ts จำนวน 205 บรรทัด. Parent ตรวจ parsed function bodies/signatures ทั้ง 25 ตัว, resolved import bindings และ public exports 19 ตัวเทียบ baseline แล้วตรงกัน ไม่มี shared state ใหม่.

| หลักฐาน | ผลที่สังเกตได้ |
| --- | --- |
| Focused regression suites | 11 files และ 179 tests ผ่าน ไม่มี skips |
| Full Web coverage command | 79 files และ 1,678 tests ผ่าน Command exit 0 |
| Coverage report | เครื่องมือรายงาน statements 93.78%, branches 90.19%, functions 93.39% และ lines 94.99% พร้อม version warning ด้านล่าง |
| Web typecheck | ผ่าน ไม่มี type errors ใน 265 files |
| Web lint และ build | ผ่าน Build มี chunk-size warning |
| Root format:check | ไม่ผ่านเฉพาะ ambient outputs สองไฟล์ด้านล่าง |
| Tracked และ candidate formatting | ผ่าน โดยยกเว้นเฉพาะ ambient paths สองไฟล์ ไม่มีการเพิ่ม ignore rule |
| Independent static code review | `ready for validation` สำหรับ candidate code ไม่มี Blocker, Major, Minor หรือ Nit ไม่ใช่ global acceptance |

ทดลอง faults ก่อนย้าย source แล้ว tests ปฏิเสธครบสี่แบบ ได้แก่ Edit ใช้ static cache, sessions gate ถูกลบ, ineligible sessions คืน redirect และ sessions ใช้ cache ผิด identity. คืน source เดิมแล้ว characterization 87 tests ผ่านก่อนเริ่ม extraction.

ข้อจำกัดที่ยังเปิดมีดังนี้.

- `bun run format:check` ยัง fail ที่ `apps/api/.vitest/json/output.json` และ `apps/web/.vitest/json/output.json` ซึ่งเป็น untracked outputs ที่มีอยู่ก่อนงานนี้ ไม่แก้ไฟล์เหล่านี้และไม่ถือว่า candidate formatting pass แทน root gate ได้.
- Coverage command เตือนว่า `vitest@5.0.3` กับ `@vitest/coverage-v8@5.0.0` เป็น mixed versions ที่ไม่รองรับ Versions มาจาก lockfile เดิมที่ไม่ได้แก้ Command/test results ผ่านจริง แต่ความเชื่อมั่นใน instrumentation และเปอร์เซ็นต์ coverage ต้องระบุคำเตือนนี้ ไม่อ้างเป็น release clearance แบบไม่มีเงื่อนไข การแก้ dependencies อยู่นอก extraction scope.
- Build เตือน chunks ใหญ่กว่า 500 kB ไม่มี historical bundle baseline จึงไม่สรุปว่า candidate เพิ่มหรือลดขนาด bundle และไม่ปรับ bundle configuration ในงานนี้.
- ไม่ได้รัน browser E2E, API/DB suites, security scanners หรือ deployment จากงานนี้ ไม่ใช้ static review แทนหลักฐานเหล่านั้น.

Source และ tests หยุด mutation แล้ว ผลตรวจทั้งหมดข้างต้นเป็นหลักฐานของ working-tree candidate ยังไม่มี commit, push หรือ release.
