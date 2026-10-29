# A36 scheduling refusal retry

Fresh isolated scoring fixture `Audit UI 0d7a5d183f`; production build at :5300,
Persian; tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`.

- `/sessions`, generation 24: focus actual row `ANBYXEW5-001` quick Cancel and
  press native Enter. PATCH `/api/sessions/34b43508-221e-4345-9615-078c1f8d0e27`
  request `a7531099-0d47-443f-aca6-236209b6af2b:782` returns **409**. Visible alert:
  `پیش از لغو جلسه، سلول‌های ارزشیابی فعال آن را حذف یا بایگانی کنید.`
  Row remains active. A wait for a misspelled Persian substring timed out;
  DOM/network inspection confirmed the expected refusal and visible alert.
- API fixture setup archives its assignment and group (`archive-target.*`).
  `/schedule`, generation 25: native Space enables archived rows; native Enter
  activates Restore for `ANBYXEW5`. PATCH assignment request
  `a7531099-0d47-443f-aca6-236209b6af2b:813` returns **400**; visible alert
  `یک گروه فعال انتخاب کنید.`; row remains archived.
- Component coverage additionally verifies stale-error clearing while a different
  action/retry is pending and after success, in both languages (**10/10**).
