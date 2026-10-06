"""İnterfeysdən uçdan-uca axın: saxta modelli server + Chrome (CDP, real kliklər).

    python scripts/fake_server.py          # ayrı terminalda: http://127.0.0.1:8011
    python tests/ui/e2e_ui.py
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
SCRATCH = Path(tempfile.mkdtemp(prefix="komite-e2e-"))
(SCRATCH / "shots2").mkdir()
PROFILE = tempfile.mkdtemp(prefix="komite-chrome-")
PORT = 9336
ROOT = Path(__file__).resolve().parents[2]
BASE = os.getenv("BASE_URL", "http://127.0.0.1:8011/")
RUN = str(int(time.time()))


async def main() -> None:
    extra = SCRATCH / "bank_telebleri.txt"
    extra.write_text("Tələb: Plan layihənin ekoloji təsirini təsvir etməlidir.\n\n"
                     "Sənəd: Bankın zəmanət məktubu ayrıca təqdim olunmalıdır.\n", encoding="utf-8")
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

            async def set_files(selector, paths):
                doc = await call("DOM.getDocument")
                node = await call("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)
                await call("DOM.setFileInputFiles", nodeId=node["nodeId"], files=[str(p) for p in paths])

            def check(name, ok, detail=""):
                results.append(bool(ok))
                print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

            async def shot(name):
                data = await call("Page.captureScreenshot", format="png")
                (SCRATCH / "shots2" / f"{name}.png").write_bytes(base64.b64decode(data["data"]))

            await call("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
            await call("Page.navigate", url=BASE)
            await wait_for("document.getElementById('dev-box') && !document.getElementById('dev-box').hidden")
            check("İnkişaf rejimində süni xəta seçimi görünür", await js("!document.getElementById('dev-box').hidden"))

            # 1) Səhv fayl: əvvəl DOCX, sonra PDF seçilir — köhnə DOCX qalmamalıdır.
            await js(f"document.getElementById('plan-id').value='UI plan {RUN}'")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await wait_for("!document.getElementById('filechip').hidden")
            check("DOCX seçiləndə fayl kartı görünür", await js("document.getElementById('filechip-name').textContent") == "plan_demo_v1.docx")
            await set_files("#file-input", [extra])        # .txt — biznes plan üçün yanlış
            await asyncio.sleep(0.3)
            check("Yanlış fayldan sonra köhnə DOCX göndərilə bilmir",
                  await js("document.getElementById('filechip').hidden && !document.getElementById('upload-error').hidden"))
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await set_files("#extra-input", [extra])
            await wait_for("document.querySelectorAll('#extra-list li').length === 1")
            check("Əlavə fayl siyahıda görünür (ad, ölçü, sil)",
                  await js("document.querySelector('#extra-list .extrafile__name').textContent") == "bank_telebleri.txt")

            # 2) Göndərmə → təsdiq ekranı
            await js("document.getElementById('submit-btn').click()")
            ok = await wait_for("!document.getElementById('view-review').hidden && document.querySelectorAll('#review-items li').length === 2")
            check("Təsdiq ekranı açılır və 2 tələb çıxarılıb", ok)
            check("Fayl 'Oxundu' statusundadır", await js("document.querySelector('#review-files .extrafile__status').textContent.startsWith('Oxundu')"))
            check("Təsdiqdən əvvəl tam yoxlama başlamayıb (nəticə yoxdur)",
                  await js("fetch('/api/checks/' + new URLSearchParams(location.search).get('check')).then(r=>r.json()).then(c=>c.result===null && c.run_state==='tesdiq_gozleyir')"))
            await shot("e2e-review")
            await js("""(() => { const a = document.querySelector('#review-items textarea');
                       a.value = a.value + ' (redaktə)'; a.dispatchEvent(new Event('input')); })()""")
            await js("document.getElementById('review-add').click()")
            await js("""(() => { const all = document.querySelectorAll('#review-items textarea');
                       const a = all[all.length - 1]; a.value = 'Marketinq büdcəsi göstərilməlidir.';
                       a.dispatchEvent(new Event('input')); })()""")
            await js("document.getElementById('review-confirm').click()")

            # 3) Nəticə
            ok = await wait_for("!document.getElementById('view-results').hidden", 30)
            check("Təsdiqdən sonra yoxlama tamamlanır və nəticə görünür", ok)
            check("Başlıqda hazırlıq statusu var", await js("document.getElementById('res-status-label').textContent"),
                  await js("document.getElementById('res-status-label').textContent"))
            await js("document.getElementById('tab-elave').click()")
            count = await js("document.querySelectorAll('#extra-results li').length")
            check("Əlavə tələblər tabında 3 bənd (redaktə + yeni + sənəd)", count == 3, str(count))
            edited = await js("[...document.querySelectorAll('.extraresult__text')].some(n=>n.textContent.includes('(redaktə)'))")
            check("Redaktə edilmiş mətn yoxlamaya düşüb", edited)
            await shot("e2e-elave")

            # 4) Eyni adla v2 → müqayisə
            await js("document.getElementById('nav-new').click()")
            await wait_for("!document.getElementById('view-upload').hidden")
            # Mövcud plana versiya — AÇIQ seçim (eyni ad avtomatik versiya yaratmır)
            await wait_for(f"[...document.getElementById('plan-select').options].some(o=>o.textContent.startsWith('UI plan {RUN}'))")
            await js(f"""(()=>{{const sel=document.getElementById('plan-select');
              const opt=[...sel.options].find(o=>o.textContent.startsWith('UI plan {RUN}'));
              document.querySelector('input[name=plan-mode][value=existing]').click();
              sel.value=opt.value; sel.dispatchEvent(new Event('change'));}})()""")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v2.docx"])
            await wait_for("!document.getElementById('filechip').hidden")
            await js("document.getElementById('submit-btn').click()")
            ok = await wait_for("!document.getElementById('view-results').hidden && document.getElementById('res-version').textContent==='v2'", 30)
            check("v2 əlavəsiz birbaşa yoxlanılır", ok)
            await js("document.getElementById('tab-muqayise').click()")
            text = await js("document.getElementById('cmp-body').textContent")
            check("Müqayisə: 3 boş yer doldurulub", "3 boş yer doldurulub" in (text or ""))
            check("Müqayisə: əlavə tələblər 'çıxarıldı' kimi meyar dəyişikliyidir",
                  "Tələb çıxarıldı" in (text or "") and "yaxşılaşması və ya pisləşməsi sayılmır" in (text or ""))
            await shot("e2e-muqayise")
            versions = await js("document.querySelectorAll('.version').length")
            check("Sol paneldə planın 2 versiyası", versions == 2, str(versions))

            # 5) Sorğu davam edərkən başqa yoxlamaya keçid
            v1_id = await js("[...document.querySelectorAll('.version')].find(b=>b.querySelector('.version__no').textContent==='v1').dataset.check")
            await js("document.getElementById('nav-new').click()")
            await wait_for("!document.getElementById('view-upload').hidden")
            # Mövcud plana versiya — AÇIQ seçim (eyni ad avtomatik versiya yaratmır)
            await wait_for(f"[...document.getElementById('plan-select').options].some(o=>o.textContent.startsWith('UI plan {RUN}'))")
            await js(f"""(()=>{{const sel=document.getElementById('plan-select');
              const opt=[...sel.options].find(o=>o.textContent.startsWith('UI plan {RUN}'));
              document.querySelector('input[name=plan-mode][value=existing]').click();
              sel.value=opt.value; sel.dispatchEvent(new Event('change'));}})()""")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await wait_for("!document.getElementById('filechip').hidden")
            await js("document.getElementById('submit-btn').click()")
            await wait_for("new URLSearchParams(location.search).get('check') && !document.getElementById('view-run').hidden", 10)
            v3_id = await js("new URLSearchParams(location.search).get('check')")
            await js(f"document.querySelector('.version[data-check=\"{v1_id}\"]') ? document.querySelector('.version[data-check=\"{v1_id}\"]').click() : null")
            await asyncio.sleep(5)                      # v3 bu müddətdə serverdə bitir
            shown = await js("document.getElementById('res-version').textContent")
            url_check = await js("new URLSearchParams(location.search).get('check')")
            check("Keçiddən sonra B (v1) göstərilir, A-nın (v3) gec cavabı ekranı dəyişmir",
                  shown == "v1" and url_check == v1_id and not await js("document.getElementById('view-results').hidden"),
                  f"göstərilən {shown}, A={v3_id}")

            # 6) Uyğunluq mərhələsində süni xəta → davam etdirmə (UI-dən)
            await js("document.getElementById('nav-new').click()")
            await wait_for("!document.getElementById('view-upload').hidden")
            await js(f"document.getElementById('plan-id').value='UI xəta {RUN}'")
            await set_files("#file-input", [ROOT / "samples" / "plan_demo_v1.docx"])
            await wait_for("!document.getElementById('filechip').hidden")
            await js("document.getElementById('fail-at').value='compliance'")
            await js("document.getElementById('submit-btn').click()")
            ok = await wait_for("!document.getElementById('run-error').hidden", 20)
            step = await js("document.getElementById('error-step').textContent")
            check("Xəta ekranı düzgün mərhələni göstərir", ok and step == "Tələblər yoxlanılır", step)
            await shot("e2e-error")
            await js("document.getElementById('retry-btn').click()")
            ok = await wait_for("!document.getElementById('view-results').hidden", 30)
            check("'Yoxlamanı davam etdir' checkpoint-dən davam edib nəticəyə çatır", ok)
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
