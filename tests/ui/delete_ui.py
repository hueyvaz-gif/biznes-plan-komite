""""Planı sil" axını: təsdiq pəncərəsi, klaviatura, ləğv, silinmə. Yalnız SAXTA serverdə.

    python scripts/fake_server.py          # ayrı terminalda: http://127.0.0.1:8011
    python tests/ui/delete_ui.py [qovluq]
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

import websockets

CHROME = os.getenv("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT = 9343
ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:8011/"          # real serverdə işlədilmir — silmə testi!
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
KEYS = {"Escape": 27, "Enter": 13, "Tab": 9}


def upload(name: str) -> dict:
    boundary = uuid.uuid4().hex
    data = (ROOT / "samples" / "plan_demo_v1.docx").read_bytes()
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="plan_name"\r\n\r\n{name}\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="fail_at"\r\n\r\n\r\n'.encode(),
             (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="plan.docx"\r\n'
              f'Content-Type: application/octet-stream\r\n\r\n').encode() + data + b"\r\n",
             f"--{boundary}--\r\n".encode()]
    req = urllib.request.Request(BASE + "api/checks", data=b"".join(parts), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(req))


def wait_done(check_id: str) -> None:
    for _ in range(150):
        state = json.load(urllib.request.urlopen(BASE + f"api/checks/{check_id}"))["run_state"]
        if state not in ("gozleyir", "isleyir"):
            return
        time.sleep(0.2)


async def main() -> None:
    name = f"Silmə testi {int(time.time())}"
    created = upload(name)
    wait_done(created["check_id"])
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={tempfile.mkdtemp()}",
                             "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        for _ in range(50):
            try:
                page = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                            if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
            seq = 0

            async def call(method, **params):
                nonlocal seq
                seq += 1
                await ws.send(json.dumps({"id": seq, "method": method, "params": params}))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("id") == seq:
                        return msg.get("result", {})

            async def js(expr):
                r = await call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
                return r.get("result", {}).get("value")

            async def wait_for(expr, timeout=15):
                for _ in range(int(timeout / 0.2)):
                    if await js(expr):
                        return True
                    await asyncio.sleep(0.2)
                return False

            async def key(name):
                for kind in ("rawKeyDown", "keyUp"):
                    await call("Input.dispatchKeyEvent", type=kind, key=name, code=name,
                               windowsVirtualKeyCode=KEYS[name])
                await asyncio.sleep(0.2)

            def check(label, ok, detail=""):
                results.append(bool(ok))
                print(("PASS " if ok else "FAIL ") + label + (f" — {detail}" if detail else ""))

            async def shot(label):
                if OUT:
                    OUT.mkdir(parents=True, exist_ok=True)
                    data = await call("Page.captureScreenshot", format="png")
                    (OUT / f"{label}.png").write_bytes(base64.b64decode(data["data"]))

            await call("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
            await call("Page.navigate", url=f"{BASE}?check={created['check_id']}")
            plan_sel = f"#history li.plan[data-plan='{created['plan_id']}']"
            await wait_for(f"!!document.querySelector(\"{plan_sel}\") && !document.getElementById('view-results').hidden")
            await js(f"(()=>{{const h=document.querySelector(\"{plan_sel} .plan__head\");"
                     "if(h.getAttribute('aria-expanded')!=='true') h.click();})()")
            await wait_for(f"!!document.querySelector(\"{plan_sel} .plan__delete\")")
            label = await js(f"document.querySelector(\"{plan_sel} .plan__delete\").getAttribute('aria-label')")
            check("Düymənin adı planı bildirir", name in (label or ""), label)

            await js(f"document.querySelector(\"{plan_sel} .plan__delete\").click()")
            check("Təsdiq pəncərəsi açılır", await wait_for("document.getElementById('delete-dialog').open"))
            check("Fokus 'Ləğv et'-dədir (təhlükəsiz seçim)", await js("document.activeElement.id") == "delete-cancel")
            check("Pəncərədə planın adı və geri qaytarılmadığı yazılıb",
                  name in await js("document.getElementById('delete-text').textContent")
                  and "geri qaytarılmır" in await js("document.getElementById('delete-warn').textContent"))
            await shot("plan-sil-tesdiq")
            await key("Escape")
            check("Escape pəncərəni bağlayır, heç nə silinmir",
                  not await js("document.getElementById('delete-dialog').open")
                  and json.load(urllib.request.urlopen(BASE + f"api/checks/{created['check_id']}"))["id"])
            check("Fokus 'Planı sil' düyməsinə qayıdır",
                  await js("document.activeElement.classList.contains('plan__delete')"))

            await key("Enter")       # fokusdakı "Planı sil" — klaviatura ilə yenidən açılır
            await wait_for("document.getElementById('delete-dialog').open")
            await js("document.getElementById('delete-confirm').click()")
            gone = await wait_for(f"!document.querySelector(\"{plan_sel}\")")
            check("Təsdiqdən sonra plan siyahıdan çıxır", gone)
            check("Açıq hesabat silinən plana aid idi — yükləmə ekranına qayıdır",
                  await wait_for("!document.getElementById('view-upload').hidden"))
            check("Ekran oxuyucuya bildirilir", "silindi" in (await js("document.getElementById('live').textContent") or ""))
            try:
                urllib.request.urlopen(BASE + f"api/checks/{created['check_id']}")
                status = 200
            except urllib.error.HTTPError as exc:
                status = exc.code
            check("Server tərəfində də silinib (404)", status == 404, str(status))
            await shot("plan-sil-sonra")
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)



if __name__ == "__main__":
    asyncio.run(main())
