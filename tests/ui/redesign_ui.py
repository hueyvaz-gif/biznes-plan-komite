"""Yeni dizayn: mərhələ göstəricisi, əlavə tələblər akkordeonu, AI köməkçi, bazar icmalı, daşma.

    python scripts/fake_server.py          # ayrı terminalda: http://127.0.0.1:8011 (saxta model)
    python tests/ui/redesign_ui.py [qovluq] # qovluq verilsə, ekran görüntüləri ora yazılır

Real model çağırılmır: 8011-də chat saxta modellə cavab verir.
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
PORT = 9338
ROOT = Path(__file__).resolve().parents[2]
BASE = os.getenv("BASE_URL", "http://127.0.0.1:8011/")
RUN = str(int(time.time()))
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None


async def main() -> None:
    bad = Path(tempfile.mkdtemp()) / "sekil.png"
    bad.write_bytes(b"\x89PNG\r\n")
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
                        if "error" in msg:
                            raise RuntimeError(msg["error"])
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

            async def key(k, code, vk):
                for t in ("keyDown", "keyUp"):
                    await call("Input.dispatchKeyEvent", type=t, key=k, code=code, windowsVirtualKeyCode=vk)

            async def set_files(selector, paths):
                doc = await call("DOM.getDocument")
                node = await call("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)
                await call("DOM.setFileInputFiles", nodeId=node["nodeId"], files=[str(p) for p in paths])

            def check(name, ok, detail=""):
                results.append(bool(ok))
                print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

            async def shot(name):
                if OUT:
                    OUT.mkdir(parents=True, exist_ok=True)
                    data = await call("Page.captureScreenshot", format="png")
                    (OUT / f"{name}.png").write_bytes(base64.b64decode(data["data"]))

            async def viewport(width):
                await call("Emulation.setDeviceMetricsOverride", width=width, height=900 if width > 900 else 844,
                           deviceScaleFactor=1, mobile=width < 900)

            await viewport(1440)
            await call("Page.navigate", url=BASE)
            await wait_for("document.querySelectorAll('#stepper-upload li').length === 3")

            # ── Yükləmə ekranı ──────────────────────────────────────────────
            check("Başlıq maketdəki kimidir",
                  await js("document.getElementById('upload-title').textContent") == "Biznes planınızı yoxlayın")
            check("Mərhələ: Sənəd cari, Tələblər və Hesabat gözləyir", await js(
                "[...document.querySelectorAll('#stepper-upload li')].map(l=>l.className.split('is-')[1]).join()")
                  == "current,todo,todo")
            check("'Hesabatda nə olacaq?' bloku görünür",
                  await js("document.querySelectorAll('.explain__item').length") == 3)
            check("Əlavə tələblər bağlıdır, aria-expanded=false",
                  await js("document.getElementById('extra-body').hidden && document.getElementById('extra-toggle')"
                           ".getAttribute('aria-expanded')==='false'"))
            await wait_for("document.getElementById('market').getAttribute('aria-busy')==='false'", 15)
            check("Bazar icmalı yükləndi (məlumat və ya dürüst boş vəziyyət)", await js(
                "document.querySelectorAll('#market-fx li').length > 0 || "
                "document.getElementById('market-fx-src').textContent.length > 0"))
            await shot("01-yukleme-1440")
            sb = await js("(()=>{const s=document.getElementById('sidebar');return [s.scrollHeight,s.clientHeight]})()")
            check("Sol panel 1440×900-də sürüşmədən sığır", sb[0] <= sb[1] + 1, f"{sb[0]}/{sb[1]}")
            check("Bazar icmalı default yığılıb (yoxlama işindən diqqəti yayındırmır)",
                  await js("!document.getElementById('market-box').open"))
            await js("document.querySelector('#market-box > summary').click()")
            await js("document.getElementById('mtab-fx').focus()")
            await key("ArrowRight", "ArrowRight", 39)
            check("Bazar tabları ox düyməsi ilə keçir", await js(
                "document.activeElement.id==='mtab-assets' && !document.getElementById('mpanel-assets').hidden && "
                "document.getElementById('mpanel-fx').hidden"))
            await js("document.getElementById('mtab-fx').click()")

            await set_files("#extra-input", [bad])
            await wait_for("!document.getElementById('extra-body').hidden")
            check("Xətalı əlavə fayl akkordeonu açır və başlıqda görünür", await js(
                "document.getElementById('extra-summary').textContent.includes('1 xəta') && "
                "document.getElementById('extra-acc').classList.contains('has-error')"))
            await js("document.getElementById('extra-toggle').click()")
            check("Bağlananda da xəta xülasəsi başlıqda qalır",
                  await js("document.getElementById('extra-body').hidden && "
                           "document.getElementById('extra-summary').textContent.includes('xəta')"))
            await js("document.getElementById('extra-toggle').click()")
            await shot("02-elave-xeta-1440")
            await js("document.querySelector('#extra-list .iconbtn').click()")
            await js(f"document.getElementById('plan-id').value='Dizayn {RUN}';"
                     "document.getElementById('plan-id').dispatchEvent(new Event('input'))")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await wait_for("document.getElementById('submit-btn').classList.contains('is-ready')")
            check("Ad və fayl olanda 'Davam et' aktiv görünür",
                  await js("document.getElementById('submit-btn').classList.contains('is-ready')"))
            check("Əlavəsiz növbəti addım — yoxlama və hesabat",
                  "yoxlama və hesabat" in await js("document.getElementById('next-step').textContent"))

            # ── AI köməkçi: ümumi rejim ─────────────────────────────────────
            check("Panel özbaşına açılmayıb", await js("document.getElementById('ai-panel').hidden"))
            await js("document.getElementById('ai-fab').click()")
            await wait_for("!document.getElementById('ai-panel').hidden")
            check("Açılanda fokus yazı sahəsinə keçir", await js("document.activeElement.id") == "ai-input")
            check("Kontekst: Sənəd yüklənməyib",
                  await js("document.getElementById('ai-context-text').textContent") == "Sənəd yüklənməyib")
            check("İki hazır sual (nəticə yoxdur)", await js("document.querySelectorAll('.aisugg__btn').length") == 2)
            await js("document.querySelectorAll('.aisugg__btn')[1].click()")
            await wait_for("document.querySelectorAll('#ai-log .aimsg--bot .aimsg__list').length > 0")
            check("Sual göndərildi və cavab siyahı kimi göstərildi", await js(
                "document.querySelector('#ai-log .aimsg--user .aimsg__bubble').textContent === 'Nələri yoxlayırsınız?' && "
                "document.querySelectorAll('#ai-log ol.aimsg__list li').length === 2"))
            await shot("03-ai-umumi-1440")
            await key("Escape", "Escape", 27)
            await asyncio.sleep(0.2)
            check("Escape paneli bağlayır və fokus düyməyə qayıdır", await js(
                "document.getElementById('ai-panel').hidden && document.activeElement.id==='ai-fab'"))

            # ── Yoxlama → plan konteksti, söhbət ayrıdır ────────────────────
            await js("document.getElementById('submit-btn').click()")
            await wait_for("!document.getElementById('view-results').hidden", 90)
            check("Yoxlama tamamlandı", await js("!document.getElementById('view-results').hidden"))
            await js("document.getElementById('ai-fab').click()")
            await wait_for("!document.getElementById('ai-panel').hidden")
            ctx = await js("document.getElementById('ai-context-text').textContent")
            check("Kontekst seçilmiş plandır", ctx.startswith(f"Dizayn {RUN} · v1") and "nəticə hazırdır" in ctx, ctx)
            check("Plan söhbəti ayrıdır — ümumi sual burada görünmür",
                  await js("document.querySelectorAll('#ai-log .aimsg--user').length") == 0)
            check("Nəticə olanda 'Hesabatı izah et' təklif olunur",
                  await js("[...document.querySelectorAll('.aisugg__btn')].some(b=>b.textContent==='Hesabatı izah et')"))
            await js("[...document.querySelectorAll('.aisugg__btn')].find(b=>b.textContent==='Hesabatı izah et').click()")
            await wait_for("document.querySelectorAll('#ai-log .aimsg--bot .aimsg__list').length > 0")
            await shot("04-ai-plan-1440")
            await js("document.getElementById('nav-new').click()")
            await wait_for("document.getElementById('ai-context-text').textContent==='Sənəd yüklənməyib'")
            check("Yeni yoxlamaya qayıdanda ümumi söhbət geri gəlir", await js(
                "[...document.querySelectorAll('#ai-log .aimsg--user .aimsg__bubble')].map(n=>n.textContent).join()") == "Nələri yoxlayırsınız?")
            await js("document.getElementById('ai-close').click()")

            # ── Reduced motion ──────────────────────────────────────────────
            await call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
            await js("document.getElementById('ai-fab').click()")
            dur = await js("getComputedStyle(document.getElementById('ai-panel')).animationDuration")
            check("prefers-reduced-motion: panel animasiyası söndürülür", dur in ("1e-06s", "0s", "0.001ms", "1e-05s")
                  or float(dur.rstrip("ms").rstrip("s") or 0) < 0.01, dur)
            await js("document.getElementById('ai-close').click()")
            await call("Emulation.setEmulatedMedia", features=[])

            # ── 3 en: üfüqi daşma yoxdur, əsas düymə əlçatandır ─────────────
            for width in (1440, 768, 390):
                await viewport(width)
                await asyncio.sleep(0.4)
                sw = await js("document.documentElement.scrollWidth")
                check(f"{width}px: üfüqi daşma yoxdur", sw <= width, f"scrollWidth={sw}")
                if width == 390:
                    await js("document.getElementById('ai-fab').click()")
                    await asyncio.sleep(0.3)
                    pw = await js("Math.round(document.getElementById('ai-panel').getBoundingClientRect().width)")
                    check("390px: chat paneli ekran enindədir", pw == 390, str(pw))
                    await shot("05-ai-390")
                    await js("document.getElementById('ai-close').click()")
                await call("Page.navigate", url=BASE)
                await wait_for("document.querySelectorAll('#stepper-upload li').length === 3")
                await asyncio.sleep(0.6)
                check(f"{width}px: 'Davam et' düyməsi görünür", await js(
                    "(()=>{const r=document.getElementById('submit-btn').getBoundingClientRect();"
                    "return r.width>0 && r.height>0})()"))
                await shot(f"06-yukleme-{width}")
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)


asyncio.run(main())
