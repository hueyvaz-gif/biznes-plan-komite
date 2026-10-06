"""Ekran görüntüləri (1440 / 768 / 390, cihaz emulyasiyası, tam səhifə) + daşma yoxlaması.

    python tests/ui/shoot.py <qovluq> upload="http://127.0.0.1:8010/?demo=1" ...
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
from pathlib import Path

import websockets

CHROME = os.getenv("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE = tempfile.mkdtemp(prefix="komite-chrome-")
PORT = 9334
WIDTHS = [(int(w), int(w) < 900) for w in os.getenv("WIDTHS", "1440,768,390").split(",")]


async def run(out: Path, scenes: list[tuple[str, str]]) -> None:
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
                             "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next(t for t in targets if t["type"] == "page")
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

            for name, url in scenes:
                for width, mobile in WIDTHS:
                    await call("Emulation.setDeviceMetricsOverride", width=width, height=900,
                               deviceScaleFactor=1, mobile=mobile)
                    await call("Page.navigate", url=url)
                    await asyncio.sleep(2.5)
                    metrics = await call("Runtime.evaluate", returnByValue=True, expression=(
                        "JSON.stringify({h: document.documentElement.scrollHeight,"
                        " sw: document.documentElement.scrollWidth})"))
                    m = json.loads(metrics["result"]["value"])
                    height = min(m["h"], 6000)
                    shot = await call("Page.captureScreenshot", format="png", captureBeyondViewport=True,
                                      clip={"x": 0, "y": 0, "width": width, "height": height, "scale": 1})
                    (out / f"{name}-{width}.png").write_bytes(base64.b64decode(shot["data"]))
                    flag = "DAŞMA!" if m["sw"] > width else "ok"
                    print(f"{name:12} {width:5}  hündürlük {height:5}  scrollWidth {m['sw']:5}  {flag}")
    finally:
        proc.terminate()


if __name__ == "__main__":
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    pairs = [arg.split("=", 1) for arg in sys.argv[2:]]
    asyncio.run(run(out_dir, [(n, u) for n, u in pairs]))
