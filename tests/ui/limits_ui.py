"""Təsdiq ekranında limit xəbərdarlığı (saxta modelli server + Chrome, CDP).

    python scripts/fake_server.py      # ayrı terminalda: http://127.0.0.1:8011
    python tests/ui/limits_ui.py

103 tələbli fayl yüklənir: xəbərdarlıq görünməli, kənarda qalan 3 bənd sadalanmalı,
təsdiq düyməsi razılıq qeyd edilənə qədər bağlı qalmalıdır.
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = os.getenv("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE = tempfile.mkdtemp(prefix="komite-chrome-")
PORT = 9339
ROOT = Path(__file__).resolve().parents[2]
BASE = os.getenv("BASE_URL", "http://127.0.0.1:8011/")


async def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="komite-limits-"))
    many = work / "cox_teleb.txt"
    many.write_text("\n\n".join(f"Tələb: planda {i}-ci göstərici olmalıdır." for i in range(103)),
                    encoding="utf-8")
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", f"--remote-debugging-port={PORT}",
                             f"--user-data-dir={PROFILE}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                return r["result"].get("value")

            async def wait_for(expr, timeout=20):
                for _ in range(int(timeout / 0.25)):
                    if await js(expr):
                        return True
                    await asyncio.sleep(0.25)
                return False

            async def set_files(selector, paths):
                doc = await call("DOM.getDocument")
                node = await call("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)
                await call("DOM.setFileInputFiles", nodeId=node["nodeId"], files=[str(p) for p in paths])

            def check(name, ok, detail=""):
                results.append(bool(ok))
                print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

            await call("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
            await call("Page.navigate", url=BASE)
            await wait_for("document.getElementById('plan-id')")
            await js(f"document.getElementById('plan-id').value='Limit {int(time.time())}'")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await set_files("#extra-input", [many])
            await wait_for("!document.getElementById('filechip').hidden")
            await js("document.getElementById('submit-btn').click()")
            ok = await wait_for("!document.getElementById('view-review').hidden && "
                                "!document.getElementById('review-limits').hidden", 30)
            check("Natamam siyahı xəbərdarlığı görünür", ok)
            text = await js("document.getElementById('review-limits-list').textContent")
            check("Alınan / saxlanılan / kənarda qalan sayları göstərilir",
                  "103" in text and "100" in text and "3 bənd limitdən" in text, text[:120])
            check("Kənarda qalan bəndlər sadalanır",
                  await js("document.querySelectorAll('#review-overlimit li').length") == 3)
            check("Razılıq olmadan təsdiq düyməsi bağlıdır", await js("document.getElementById('review-confirm').disabled"))
            await js("document.getElementById('review-ack').click()")
            check("Razılıqdan sonra təsdiq açılır", not await js("document.getElementById('review-confirm').disabled"))
            await js("document.getElementById('review-confirm').click()")
            ok = await wait_for("!document.getElementById('view-results').hidden", 60)
            check("Təsdiqdən sonra yoxlama tamamlanır", ok)
            await js("document.getElementById('tab-elave').click()")
            check("Nəticədə natamamlıq xəbərdarlığı qalır",
                  "natamam" in (await js("document.getElementById('extra-meta').textContent") or ""))
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
