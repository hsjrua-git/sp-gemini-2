# A25 production-build browser retry

- Fresh fixture `Audit UI 0d7a5d183f`, preparation/readback retained alongside.
- Tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation 23, Persian, width 1233,
  `http://127.0.0.1:5300/evaluate`, production build with Express-equivalent CSP.
- Actual pointer checkbox activation and browser field input **۷ / ۶** leave
  Save enabled (`ذخیرهٔ 1 تغییر`), no validation error. Actual Save click sends
  PUT `/api/evaluations/bulk`, request ID
  `a7531099-0d47-443f-aca6-236209b6af2b:753`, **200**, changed **1**.
- Captured body: session `34b43508-221e-4345-9615-078c1f8d0e27`, group target,
  parameter `01384304-b0fa-4e00-82d9-201ac38b94e6`, quality **7**, quantity **6**,
  selected true, both comments null. Success text `ذخیره شد. 1 خانه تغییر کرد.`
- Independent API readback matches. Only console error is the initial expected
  signed-out `/api/auth/me` 401. An initial post-login wait used the wrong Persian
  heading; timed out despite successful login. Inspection confirmed the page.
- Pointer activation succeeded in this retry; prior UnknownVizError evidence
  remains a harness limitation of the earlier run.
