# F-004 การจัดการสมาชิกใน Organization

| Field                  | Value                                      |
| ---------------------- | ------------------------------------------ |
| Epic                   | `E-002`, `docs/epics/E-002-organization-member-governance.md` |
| Direction              | `DIR-001/v2` S2                            |
| Owner                  | Product Owner role, บุคคลยังไม่ยืนยัน      |
| delivery_status        | Refining                                   |
| outcome_status         | Not measured                               |
| Scope approved by user | 2026-09-27                                 |
| acceptanceVersion      | `F-004-AC-3`                               |
| Acceptance status      | frozen                                     |

## Problem and scope

ผู้ดูแล Organization ต้องทราบว่าใครเข้าถึงข้อมูลขององค์กร และจัดการการเข้าร่วม บทบาท และการพ้นสมาชิกได้โดยไม่เปิดเผยข้อมูลข้าม Organization

- In scope:
  - ดูชื่อ อีเมล และ role ของสมาชิกใน Organization ที่เลือก โดยจำกัดหน้ารายชื่อไว้สำหรับ `owner` และ `admin`
  - จำกัดสมาชิกต่อ Organization ไม่เกิน 1,000 คน และบังคับเพดานนี้เมื่อรับคำเชิญพร้อมกัน
  - เชิญสมาชิกด้วยอีเมลและ role
  - เปลี่ยน role ของสมาชิก
  - ถอนสมาชิกออกจาก Organization
  - ออกจาก Organization ด้วยตนเอง
  - รักษา owner อย่างน้อยหนึ่งคน
  - แยก loading, pending, denied, failure และ success โดยไม่ใช้ข้อมูลจาก Organization เดิม
- Non-goals:
  - สร้างหรือลบ Organization
  - Project-level permissions
  - จัดการบัญชี รหัสผ่าน หรือ MFA
  - แสดง ยกเลิก หรือส่งคำเชิญค้างซ้ำ
  - Bulk member actions
  - Cloud IAM/GRC และ audit report UI
  - ลบบัญชีผู้ใช้
  - กำหนด release หรือ outcome metric

Organization เป็น tenant boundary ทุก operation ต้องตรวจ session, membership และ permission ที่ server ค่า Organization จาก URL, browser หรือ session mirror เป็นเพียงข้อมูลประกอบและไม่ให้สิทธิ์ ข้อมูลสมาชิกของ Organization A ต้องไม่ปรากฏใน Organization B

### Permission matrix

| Operation | owner | admin | viewer / auditor |
| --------- | ----- | ----- | ---------------- |
| ดูรายชื่อ ชื่อ อีเมล และ role | อนุญาต | อนุญาต | ไม่อนุญาต |
| เชิญเป็น `owner` | อนุญาต | ไม่อนุญาต | ไม่อนุญาต |
| เชิญเป็น `admin`, `viewer` หรือ `auditor` | อนุญาต | อนุญาต | ไม่อนุญาต |
| เปลี่ยน role ที่เกี่ยวข้องกับ `owner` | อนุญาต ถ้ายังเหลือ owner อย่างน้อยหนึ่งคน | ไม่อนุญาต | ไม่อนุญาต |
| เปลี่ยน role ของสมาชิกที่ไม่ใช่ `owner` เป็น role ที่ไม่ใช่ `owner` | อนุญาต | อนุญาต | ไม่อนุญาต |
| ถอน `owner` | อนุญาต ถ้ายังเหลือ owner อย่างน้อยหนึ่งคน | ไม่อนุญาต | ไม่อนุญาต |
| ถอนสมาชิกที่ไม่ใช่ `owner` | อนุญาต | อนุญาต | ไม่อนุญาต |
| ออกจาก Organization ด้วยตนเอง | อนุญาต ถ้ายังเหลือ owner อย่างน้อยหนึ่งคน | อนุญาต | อนุญาต |

## UI flow

1. ผู้ใช้เลือก Organization จาก shell แล้วเปิด “องค์กร → สมาชิก” หน้าแสดงชื่อและ slug ของ Organization เพื่อแยกองค์กรที่ชื่อซ้ำกัน
2. ระบบตรวจ session, membership และ permission ก่อนแสดงรายชื่อ ระหว่างตรวจไม่แสดงข้อมูลหรือ action จาก cache ของ Organization ก่อนหน้า
3. `owner` และ `admin` เห็นชื่อ อีเมล และ role ของสมาชิกใน Organization ที่เลือกครั้งละไม่เกิน 50 คน พร้อมจำนวนสมาชิกทั้งหมด ตัวควบคุมหน้าก่อนหน้าและหน้าถัดไป และเฉพาะ action ที่ permission matrix อนุญาต `viewer` และ `auditor` ไม่เห็นรายชื่อ แต่ยังเข้าถึง action “ออกจากองค์กร” ของตนเองได้
4. ผู้มีสิทธิ์เชิญเปิดฟอร์ม กรอกอีเมลและเลือก role ที่ตนอนุญาตให้เชิญ หลัง submit ระบบแสดง pending และป้องกัน submit ซ้ำ
5. เมื่อสร้างคำเชิญสำเร็จ UI แจ้งว่า “สร้างคำเชิญแล้ว” หาก SMTP ไม่รับอีเมล UI แจ้งเพิ่มว่า “อีเมลส่งไม่สำเร็จ” โดยไม่อ้างว่าอีเมลถึงผู้รับหรือผู้รับเป็นสมาชิกแล้ว
6. ผู้มีสิทธิ์เปลี่ยน role เลือก role ใหม่แล้วบันทึก การเปลี่ยนที่เกี่ยวข้องกับ `owner` ต้องยืนยันสมาชิก Organization role ใหม่ และผลกระทบก่อนส่ง การเปลี่ยน role อื่นไม่ต้องยืนยัน
7. ผู้มีสิทธิ์ถอนสมาชิกต้องยืนยันสมาชิก Organization และผลกระทบก่อนส่ง สมาชิกทุก role ใช้ action “ออกจากองค์กร” สำหรับตนเองและต้องยืนยัน Organization กับผลกระทบก่อนส่ง การยกเลิก confirmation ไม่ส่ง mutation
8. หลังถอนหรือออกสำเร็จ request ถัดไปที่อ้าง Organization เดิมต้องถูก server ปฏิเสธ `/api/me/context` ของ session ที่ยังใช้ได้ต้องตอบ context ปัจจุบันโดยไม่มี membership หรือ active selection ของ Organization เดิม UI ล้างข้อมูลเมื่อได้รับ denial หรือ context refresh แล้วไปยัง active Organization ที่ server ยืนยัน ถ้าไม่มี Organization อื่นให้ไปหน้า no-access แท็บอื่นไม่ต้องรับ real-time signal
9. การสลับ Organization publish scope ใหม่หลัง server ยืนยัน membership แล้วเท่านั้น เมื่อสำเร็จระบบทิ้ง form draft ปิด overlay และไม่นำผล UI จากคำขอ pending ของ Organization เดิมมาใช้ ถ้าถูกปฏิเสธต้องไม่แสดง Organization ปลายทางเป็น active scope
10. เมื่อ permission, owner count หรือ target เปลี่ยนก่อน mutation ถูกตัดสิน server ใช้สถานะปัจจุบัน UI แสดง denied หรือ failure ไม่แสดง success จาก state ที่หมดอายุ ไม่ replay mutation อัตโนมัติ และ refresh เป็นค่าล่าสุดที่ server ยืนยัน

| Screen | Loading / pending | Empty | Error และ recovery | Denied | Success |
| ------ | ----------------- | ----- | ------------------ | ------ | ------- |
| รายชื่อสมาชิก | แสดง “กำลังโหลดสมาชิก” โดยไม่แสดงข้อมูลเก่าหรือหน้าก่อนหน้า | ไม่ใช้ empty state เพราะ `owner` หรือ `admin` ที่ผ่าน authorization เป็นสมาชิกอย่างน้อยหนึ่งคน | แสดง “โหลดสมาชิกไม่สำเร็จ” พร้อมลองใหม่ ไม่แปลง failure เป็น empty | ไม่แสดงรายชื่อ จำนวนทั้งหมด หรือข้อมูลเป้าหมาย; สมาชิกยังใช้ action ออกจาก Organization ของตนเองได้ | แสดงจำนวนสมาชิกทั้งหมด พร้อมชื่อ อีเมล และ role เฉพาะ Organization ที่เลือกครั้งละไม่เกิน 50 คน และหน้าก่อนหน้า/ถัดไปตามผล server |
| เชิญสมาชิก | ปิด submit ซ้ำและแสดง “กำลังสร้างคำเชิญ” | ฟอร์มว่างไม่ใช่ empty state | แสดง field error ใกล้ช่อง คงค่าที่กรอกใน Organization เดิม และไม่แสดง success; หากสร้าง invitation แล้วแต่ SMTP ไม่รับอีเมล แสดง “สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ” เป็นคำเตือน | ไม่ส่งคำขอและไม่แสดง role ที่ actor เชิญไม่ได้ | แสดง “สร้างคำเชิญแล้ว” โดยยังไม่เพิ่มผู้รับเป็นสมาชิก |
| เปลี่ยน role | แสดงสมาชิก Organization และ role ที่กำลังบันทึก | ไม่มี target จึงไม่มี action | ไม่แสดง role ที่ส่งไปเป็น success และ refresh เป็น role ล่าสุดที่ server ยืนยัน; `LAST_OWNER` อธิบายว่าต้องมี owner อย่างน้อยหนึ่งคน | ไม่เปลี่ยน role และไม่เปิดเผย target ที่ไม่มีสิทธิ์ | แสดง role ใหม่หลัง server ยืนยัน |
| ถอนสมาชิก | แสดง confirmation ก่อนส่งและป้องกัน submit ซ้ำ | ไม่มี target จึงไม่มี action | คงแถวจน refresh ยืนยันสถานะล่าสุดและไม่แสดง success; `LAST_OWNER` คงสมาชิกไว้ | ไม่ถอนและไม่เปิดเผย target ที่ไม่มีสิทธิ์ | นำสมาชิกออกจากรายการหลัง server ยืนยัน |
| ออกจาก Organization | แสดง confirmation ก่อนส่งและป้องกัน submit ซ้ำ | ไม่มี membership จึงไม่มี action | คง membership จน refresh ยืนยันสถานะล่าสุดและไม่แสดง success; `LAST_OWNER` คงสิทธิ์เดิม | request ที่อ้าง Organization เดิมหลังถูกถอนต้องถูกปฏิเสธ จากนั้น UI ล้างข้อมูลและออกจาก scope เดิม | ไป active Organization ที่ server ยืนยันหรือหน้า no-access |

Overlay ต้องมีชื่อ การปิดและทางกลับที่ชัดเจน กัก focus ขณะเปิด เมื่อปิดให้คืน focus ไป opener ที่ยังอยู่ ถ้า opener ถูกลบหรือเปลี่ยน scope ให้ย้าย focus ไป heading หรือ action หลักที่ยังอยู่ ฟอร์มใช้ label ที่คงอยู่ แสดง error และ status ที่ assistive technology อ่านได้ ไม่สื่อสถานะด้วยสีอย่างเดียว หน้าและ table ต้องใช้ keyboard ได้และรองรับหน้าจอแคบกับข้อความ 200% ตาม `docs/design-system.md`

## Stories

- `F-004-S01` ในฐานะ `owner` หรือ `admin` ฉันดูชื่อ อีเมล และ role ของสมาชิกใน Organization ที่เลือก เพื่อทราบว่าใครเข้าถึงองค์กร ครอบคลุม `AC-01`–`AC-04`
- `F-004-S02` ในฐานะผู้มีสิทธิ์เชิญ ฉันสร้างคำเชิญด้วยอีเมลและ role ที่อนุญาต เพื่อให้ผู้รับมีทางเข้าร่วม Organization ครอบคลุม `AC-05`–`AC-07`
- `F-004-S03` ในฐานะผู้มีสิทธิ์จัดการ role ฉันเปลี่ยน role ของสมาชิกโดยไม่ทำให้ owner คนสุดท้ายหายไป ครอบคลุม `AC-08`–`AC-10`
- `F-004-S04` ในฐานะผู้มีสิทธิ์ถอนสมาชิก ฉันถอนสมาชิกออกจาก Organization โดยไม่ถอน owner คนสุดท้าย ครอบคลุม `AC-11`, `AC-12` และผลหลังถูกถอนใน `AC-15`
- `F-004-S05` ในฐานะสมาชิกทุก role ฉันออกจาก Organization ด้วยตนเองโดยไม่ลบบัญชีหรือ membership ใน Organization อื่น ครอบคลุม `AC-13`–`AC-15`
- ข้อกำหนดการสลับ Organization ผลคำขอที่กลับมาภายหลัง และ accessibility ใช้กับ `F-004-S01`–`F-004-S05` ผ่าน `AC-16`–`AC-17`

## Acceptance matrix

`F-004-AC-2` frozen เมื่อ 2026-09-27 หลังผู้ใช้อนุมัติ corrected contract: offset pagination ครั้งละ 50 คนพร้อม `total`, hard cap 1,000 และคำเตือนเมื่อ SMTP failure แทน `F-004-AC-1` การ freeze ล็อก `AC-01`–`AC-17` แต่ไม่อนุญาตให้เริ่ม implementation หรือ release

`F-004-AC-3` แทน `F-004-AC-2` เมื่อ 2026-10-03 ตามคำตัดสินของผู้ใช้ผ่าน coordinator ต่างจาก `F-004-AC-2` เฉพาะข้อยกเว้นใน `AC-02` (`auditor` เห็นชื่อสมาชิกในหน้าบันทึกกิจกรรมตาม `F-007` `OD-16`) `AC-01` และ `AC-03`–`AC-17` ไม่เปลี่ยน สถานะยังเป็น frozen และไม่อนุญาตให้เริ่ม implementation หรือ release

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| AC-01 | Scope | หน้ารายชื่อของ Organization A แสดงจำนวนสมาชิกทั้งหมด พร้อมชื่อ อีเมล และ role ของสมาชิก A ครั้งละไม่เกิน 50 คน ข้อมูลหรือจำนวนสมาชิก B ไม่ปรากฏในทุกหน้าแม้ actor เป็นสมาชิกทั้ง A และ B | ใช้ actor A-only, B-only และ A+B เปิด A/B ผ่าน UI และ request ตรง ไล่หน้าก่อนหน้า/ถัดไป แล้วเทียบ `total` และรายการกับสมาชิกแต่ละ Organization รวม boundary 49, 50 และ 51 คน |
| AC-02 | Authorization | `owner` และ `admin` อ่านรายชื่อได้ `viewer`, `auditor` และ non-member ไม่เห็นรายชื่อหรือข้อมูลสมาชิก แต่สมาชิกทุก role ยังเข้าถึง action ออกจาก Organization ของตนเองได้ ข้อยกเว้น: `auditor` เห็นชื่อสมาชิกที่เป็นผู้ดำเนินการหรือเป้าหมายในหน้าบันทึกกิจกรรมตาม `F-007` `OD-16` โดยไม่เห็นรายชื่อสมาชิกในหน้านี้ | เปิดหน้าและเรียก list endpoint ตรงด้วยทุก role กับ non-member ตรวจ denied และตรวจว่า viewer/auditor เปิด self-leave flow ได้โดยไม่เห็นรายชื่อ |
| AC-03 | State | ระหว่างโหลดครั้งแรกหรือเปลี่ยนหน้าแสดง loading โดยไม่มีข้อมูลเก่าหรือหน้าก่อนหน้า Failure แสดง error พร้อม retry และไม่แสดง empty หรือ success | ทำให้ request แรกและ request เปลี่ยนหน้าค้างหรือล้มเหลว แล้วตรวจข้อความ ข้อมูลที่แสดง retry และการกลับหน้าก่อนหน้า |
| AC-04 | Security | ผล denied ไม่เปิดเผยว่า Organization หรือ target มีอยู่จริง Response, logs และ audit ของ failure/denied ไม่บันทึกชื่อ อีเมล token หรือข้อมูลเป้าหมาย | ใช้ actor ที่ไม่มีสิทธิ์เรียก list/invite/update/revoke/leave กับ Organization และ target ที่มี/ไม่มีจริง เปรียบเทียบ status, code, message และ body พร้อมตรวจ logs/audit ว่าไม่มี PII หรือข้อมูลเป้าหมาย |
| AC-05 | Authorization / concurrency | `owner` เชิญได้ทุก role `admin` เชิญได้เฉพาะ `admin`, `viewer` และ `auditor`; role อื่นเชิญไม่ได้ คำเชิญผูกกับ Organization ที่เลือก และ server ใช้ permission ปัจจุบันเมื่อตัดสินคำขอ | ทดลองทุก actor/role ใน A และ B ผ่าน UI/request ตรง เปลี่ยน role หรือถอน actor ระหว่าง pending แล้วตรวจว่าคำขอที่แพ้ไม่สร้าง invitation และไม่มีข้อมูลข้าม Organization |
| AC-06 | State | ฟอร์มเชิญมี label และ field error ระหว่าง submit แสดง pending และไม่ส่งซ้ำ Failure ก่อนสร้าง invitation คงค่าที่กรอกภายใน Organization เดิมและไม่แสดง success หาก invitation ถูกสร้างแล้วแต่ SMTP ไม่รับอีเมล แสดง “สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ” โดยไม่ส่งคำขอซ้ำอัตโนมัติ | ใส่อีเมลว่างหรือผิดรูป กด submit ซ้ำ ทำให้ request ล้มเหลวก่อน insert สำเร็จพร้อม SMTP accepted และสำเร็จพร้อม SMTP failure แล้วตรวจจำนวน request ค่าฟอร์ม ข้อความ และ invitation row |
| AC-07 | Boundary / invariant | Success แสดง “สร้างคำเชิญแล้ว” และเพิ่ม “อีเมลส่งไม่สำเร็จ” เฉพาะเมื่อ SMTP ไม่รับอีเมล ผู้รับยังไม่เป็นสมาชิกและเข้าถึง Organization ไม่ได้จนกว่าจะตอบรับสำเร็จ Organization มีสมาชิกได้ไม่เกิน 1,000 คนแม้รับหลายคำเชิญพร้อมกัน คำขอที่แพ้เพราะเต็มไม่รับ invitation และไม่สร้าง membership ไม่มี resend/cancel ใน Feature นี้ | ตรวจ invitation อยู่ใน Organization ที่เลือก ตรวจ membership, `/api/me/context` และ protected read ก่อนเชิญ หลังสร้างคำเชิญทั้งสองผล SMTP และหลังตอบรับ ทดสอบ 999/1,000 คนและ concurrent accepts ที่เริ่มจาก 999 คน พร้อมตรวจ count <= 1,000, losing response และ invitation ที่แพ้ยัง pending |
| AC-08 | Authorization | `owner` เปลี่ยน role ที่เกี่ยวข้องกับ `owner` ได้เมื่อไม่ละเมิด last-owner invariant; `admin` จัดการได้เฉพาะ target และ role ที่ไม่ใช่ `owner`; `viewer` และ `auditor` จัดการ role ไม่ได้ Server ใช้ role และ membership ปัจจุบัน | ทดลอง actor/target/role ทุกกลุ่มและ request ตรง เปลี่ยนสิทธิ์ actor ก่อนส่ง mutation แล้วตรวจ persisted role ไม่เปลี่ยนเมื่อ denied |
| AC-09 | State / confirmation | การเปลี่ยนที่เกี่ยวข้องกับ `owner` แสดง confirmation ที่ระบุ target, Organization, role ใหม่ และผลกระทบ การยกเลิกไม่ส่ง mutation ทุก role change แสดง pending และหลัง failure แสดง role ล่าสุดที่ server ยืนยันโดยไม่มี false success | ทดสอบยกเลิก success และ failure; เปลี่ยน target role จาก session อื่นระหว่าง pending แล้วตรวจ UI กับ persisted role ล่าสุด |
| AC-10 | Invariant / concurrency | ทุกผลลัพธ์ของ role mutations ต้องเหลือ owner อย่างน้อยหนึ่งคน คำขอที่แพ้ได้รับ denied/failure และไม่แสดง success | ใช้ Organization ที่มี owner หนึ่งและสองคน รวมสอง concurrent requests ที่แข่งกันลด role ของ owner แล้วตรวจ owner count >= 1 และ UI ของ losing request |
| AC-11 | Authorization / confirmation | `owner` ถอน owner ได้เมื่อยังเหลือ owner คนอื่นและถอน non-owner ได้ `admin` ถอนได้เฉพาะ non-owner; `viewer` และ `auditor` ถอนไม่ได้ Confirmation ระบุ target, Organization และผลกระทบ การยกเลิกไม่ส่ง mutation | ทดลองทุก actor/target ทั้งยกเลิกและยืนยันผ่าน UI/request ตรง แล้วตรวจ membership และไม่มีข้อมูล target รั่วเมื่อ denied |
| AC-12 | Invariant / concurrency | ถอน owner คนสุดท้ายไม่ได้ Target หรือ permission ที่เปลี่ยนก่อน server ตัดสินใช้สถานะปัจจุบัน คำขอที่แพ้ไม่แสดง success | ทดสอบ `LAST_OWNER`, target/actor change และสอง concurrent requests ถอน owner จาก Organization ที่เริ่มด้วยสอง owner แล้วตรวจ owner count >= 1 |
| AC-13 | Scope | สมาชิกทุก role ออกจาก Organization ของตนเองได้หลัง confirmation การออกพ้นเฉพาะ Organization นั้น บัญชีและ membership ใน Organization อื่นยังอยู่ | ทดสอบ owner/admin/viewer/auditor ผ่าน UI ใช้สมาชิก A+B ออกจาก A แล้วตรวจบัญชี membership B และ request ไป A |
| AC-14 | Invariant / concurrency | Owner คนสุดท้ายออกไม่ได้ Confirmation ระบุ actor, Organization และผลกระทบ การยกเลิกไม่ส่ง mutation เมื่อมี owner อีกคนจึงออกได้และทุก race ต้องเหลือ owner อย่างน้อยหนึ่งคน | เปรียบเทียบ owner หนึ่ง/สองคนและสอง concurrent leave/demotion requests แล้วตรวจ owner count >= 1, persisted membership และ losing UI |
| AC-15 | Revocation transition | หลังออกหรือถูกถอน server ปฏิเสธ request ถัดไปที่อ้าง Organization เดิมด้วย session เดิม `/api/me/context` ที่ session ยังใช้ได้ตอบ context โดยไม่มี membership และ active selection ของ Organization เดิม UI ล้างข้อมูลเมื่อได้รับ denial หรือ context refresh แล้วไป active Organization ที่ server ยืนยัน หรือหน้า no-access แท็บอื่นไม่ต้องล้างก่อน request/refresh | ถอนสมาชิกจากอีก session แล้วใช้แท็บเดิมตรวจว่า list/mutation ที่อ้าง Organization เดิมถูกปฏิเสธ; ตรวจ `/api/me/context` ตอบ context ปัจจุบันโดยไม่มี Organization เดิมและยังมี membership อื่นตามจริง; ตรวจ UI ล้างข้อมูลและไป scope ที่ยืนยันหรือ no-access |
| AC-16 | Concurrency / isolation | Organization B เป็น active scope หลัง server ยืนยัน switch เท่านั้น เมื่อสำเร็จ draft, overlay และผล read/mutation ที่ค้างจาก A ไม่เปลี่ยนข้อมูล notice role หรือ action ของ B หาก switch ถูกปฏิเสธต้องไม่แสดง B เป็น active scope Mutation A ที่ server commit แล้วไม่ต้อง rollback | ค้าง read/mutation ของ A แล้วสลับ A→B ทั้งกรณีสำเร็จและ denied ปล่อย response A กลับมาและตรวจ selected scope, list, notice, role/actions กับ no-access |
| AC-17 | Accessibility | รายชื่อ ตัวควบคุมหน้า ฟอร์ม และ confirmation ใช้ keyboard ได้ มี visible focus, meaningful names และ status/error ที่ assistive technology อ่านได้ Overlay กัก focus และเมื่อปิดคืน focus ไป opener ที่ยังอยู่หรือ heading/action ที่ยังอยู่หลังลบหรือเปลี่ยน scope หน้าไม่เสีย action/label ที่หน้าจอแคบและข้อความ 200% | ตรวจ keyboard-only ตั้งแต่ list และ pagination ถึง invite/role/revoke/leave, loading/denied/failure/warning, focus trap/restore หลังยกเลิกและสำเร็จ, switch ขณะ overlay เปิด, narrow viewport และ text zoom 200% ใน light/dark themes |

## Open decisions

| Decision | Owner |
| -------- | ----- |
| ยืนยันบุคคลที่ accountable สำหรับ Feature | Product Owner |

## Decision record and evidence

ผู้ใช้ยืนยันขอบเขตครบห้า operation, จำกัด member list ให้ `owner`/`admin`, ใช้ permission matrix ตาม behavior ปัจจุบัน, ใช้ข้อความ success ว่า “สร้างคำเชิญแล้ว”, เลือก confirmation พร้อมล้าง UI state ทันทีเมื่อสลับ Organization และกำหนดให้แท็บเดิมล้างข้อมูลเมื่อ request ถัดไปที่อ้าง Organization เดิมถูกปฏิเสธหรือ context refresh ไม่มี membership เดิม เมื่อ 2026-09-27 ผู้ใช้เปลี่ยน Feature identity จาก `F-001` เป็น `F-004` เพื่อไม่ให้ชนกับ Project candidate `F-001` ใน `E-001`

ผู้ใช้เลือก offset pagination ครั้งละ 50 คนพร้อม `total` และผล SMTP failure แบบสร้าง invitation แล้วพร้อมคำเตือนเมื่อ 2026-09-27

ผู้ใช้กำหนด hard cap 1,000 คนเมื่อ 2026-09-27 หลังพบว่า Better Auth 1.6.23 ตรวจ `membershipLimit` ก่อน claim invitation และ native concurrent accepts อาจเกิน cap Candidate จึงกำหนด first-party locked acceptance แทน native accept

Product Owner และ Technical Lead รีวิวและอนุมัติ `F-004-AC-1` ก่อนถูกแทนด้วย `F-004-AC-2` การอนุมัติ `F-004-AC-2` รอบแรกถูกเปิดใหม่เพราะ artifact ไม่ตรง pagination contract ผู้ใช้อนุมัติ corrected `F-004-AC-2` ที่มี exact `total`, hard cap 1,000 และ first-party locked acceptance เมื่อ 2026-09-27 ไม่มีการประเมินว่า implementation ผ่านเกณฑ์

ผู้ใช้ตัดสินผ่าน coordinator เมื่อ 2026-10-02 (`F-007` `OD-16`) ให้ `auditor` เห็นชื่อสมาชิกที่เป็นผู้ดำเนินการหรือเป้าหมายในหน้าบันทึกกิจกรรมของ `F-007` Product Owner จึงเพิ่มข้อยกเว้นใน `AC-02` สิทธิ์ของหน้ารายชื่อสมาชิกและ endpoint ของ `F-004` ไม่เปลี่ยน การแก้นี้เปลี่ยนข้อความของ `AC-02` ที่ frozen ใน `F-004-AC-2` เมื่อ 2026-10-03 ผู้ใช้ตัดสินผ่าน coordinator ให้ออก `F-004-AC-3` ซึ่งรวมข้อยกเว้นนี้

Observed implementation ซึ่งใช้เป็นหลักฐาน ไม่ใช่อำนาจกำหนด requirement:

- `apps/api/src/auth/permissions.ts` มี role `owner`, `admin`, `viewer` และ `auditor`; `viewer`/`auditor` ไม่มี organization-management permission
- `apps/api/src/organization-notifications/members.ts` ตรวจ owner/admin, จำกัดการจัดการ owner, ป้องกัน `LAST_OWNER`, ถอน membership และล้าง active Organization ของผู้พ้นสมาชิก
- `apps/web/src/pages/WorkspacePage.tsx` มีฟอร์มเชิญสำหรับ `owner`/`admin`
- `apps/web/src/components/shell/nav-config.ts` ยังไม่มี member-list destination
- `apps/api/src/me/service.ts` คืนเฉพาะ Organization memberships ของผู้ใช้ ไม่ใช่ member-list contract

ความเสี่ยงหลักคือการเปิดเผยชื่อหรืออีเมลข้าม Organization, privilege escalation ผ่าน role change, Organization ไม่มี owner และ response ของ tenant เดิมเปลี่ยน UI ของ tenant ใหม่ Acceptance criteria `AC-01`, `AC-04`, `AC-08`, `AC-10`, `AC-12`, `AC-14` และ `AC-16` กำหนดขอบเขตตรวจความเสี่ยงเหล่านี้
