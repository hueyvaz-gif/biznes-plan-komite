"""Çap görünüşündən PDF (Chrome, CDP `Page.printToPDF` — Playwright page.pdf() ilə eyni mexanizm).

    python tests/ui/print_pdf.py <url> <çıxış.pdf>
    məs.: python tests/ui/print_pdf.py "http://127.0.0.1:8010/?demo=1&check=<id>" hesabat.pdf

Səhifə açılır, `prepareForPrint()` çağırılır (süzgəclər sıfırlanır), sonra @page
ölçüsü (A4) ilə PDF yaradılır. Səhifələrin yoxlanması üçün: pypdf ilə hər səhifədə
mətn olduğu (boş səhifə yoxdur) və Azərbaycan hərflərinin çıxarıldığı yoxlanılır.
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

import websockets

CHROME = os.getenv("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT = 9343


async def main(url: str, out: str) -> None:
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", f"--remote-debugging-port={PORT}",
                             f"--user-data-dir={tempfile.mkdtemp(prefix='komite-print-')}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                        if "error" in msg:
                            raise RuntimeError(msg["error"])
                        return msg.get("result", {})

            await call("Page.navigate", url=url)
            await asyncio.sleep(4)
            await call("Runtime.evaluate", expression="prepareForPrint()")
            await asyncio.sleep(1)
            pdf = await call("Page.printToPDF", printBackground=True, preferCSSPageSize=True)
            with open(out, "wb") as fh:
                fh.write(base64.b64decode(pdf["data"]))
    finally:
        proc.terminate()

    from pypdf import PdfReader
    reader = PdfReader(out)
    texts = [page.extract_text() or "" for page in reader.pages]
    blank = [i + 1 for i, t in enumerate(texts) if len(t.strip()) < 40]
    letters = {ch: any(ch in t for t in texts) for ch in "əğıöşüçƏĞİÖŞÜÇ"}
    print(f"Səhifə: {len(texts)} | boş səhifə: {blank or 'yoxdur'}")
    print("Hərflər:", " ".join(f"{k}{'✓' if v else '✗'}" for k, v in letters.items()))
    print("Alt qeyd hər səhifədə:", all("İnvestisiya qərarı deyil" in t for t in texts))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
