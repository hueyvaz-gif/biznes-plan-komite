"""Aydınlıq qəbul meyarları: saylar, ayrıca sənədlər, hesabatın açılması, boş jurnal, plan seçimi, "Ətraflı".

    python scripts/fake_server.py          # ayrı terminalda: http://127.0.0.1:8011
    python tests/ui/clarity_ui.py [qovluq]
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
PORT = 9341
ROOT = Path(__file__).resolve().parents[2]
BASE = os.getenv("BASE_URL", "http://127.0.0.1:8011/")
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def demo_ids():
    checks = json.loads((ROOT / "static" / "demo" / "demo.json").read_text(encoding="utf-8"))["checks"]
    find = lambda name, v=1: next(k for k, c in checks.items()   # noqa: E731
                                  if (c.get("plan_name") or c["plan_id"]) == name and c["version"] == v)
    return find("Demo zavod"), find("Demo əlavə tələblər")


async def main() -> None:
    zavod, extra = demo_ids()
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

            async def wait_for(expr, timeout=20):
                for _ in range(int(timeout / 0.2)):
                    if await js(expr):
                        return True
                    await asyncio.sleep(0.2)
                return False

            def check(name, ok, detail=""):
                results.append(bool(ok))
                print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

            async def shot(name):
                if OUT:
                    OUT.mkdir(parents=True, exist_ok=True)
                    data = await call("Page.captureScreenshot", format="png")
                    (OUT / f"{name}.png").write_bytes(base64.b64decode(data["data"]))

            await call("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)

            # 3) Saxlanmış hesabatın açılması: "Yoxlama gedir" / "Gözləyir" GÖRÜNMÜR
            await call("Page.navigate", url=f"{BASE}?demo=1&check={zavod}&tab=xulase")
            seen = set()
            for _ in range(40):
                state = await js("(()=>{const r=document.getElementById('view-run');"
                                 "return r && !r.hidden ? document.getElementById('run-title').textContent + '|' + "
                                 "(document.getElementById('stepper-run').hidden ? 'gizli' : 'görünür') + '|' + "
                                 "(document.querySelector('#view-run .runlayout').hidden ? 'gizli' : 'görünür') : 'nəticə'})()")
                seen.add(state)
                if state == "nəticə":
                    break
                await asyncio.sleep(0.05)
            bad = [s for s in seen if s and ("Yoxlama gedir" in s or "|görünür" in s)]
            check("Hesabat açılanda 'Yoxlama gedir' və mərhələlər görünmür", not bad, ", ".join(sorted(seen)))
            await wait_for("!document.getElementById('view-results').hidden")
            # Yüklənmə anı: cavab gəlməzdən ƏVVƏL ekran (sinxron ölçmə)
            loading = await js("""(()=>{openCheck(state.check.id, {keepTab: true});
              return {title: document.getElementById('run-title').textContent,
                      loader: !document.getElementById('run-loading').hidden,
                      steps: !document.getElementById('stepper-run').hidden,
                      lead: !document.getElementById('run-lead').hidden}})()""")
            check("Yüklənmə anında 'Hesabat açılır…' göstərilir, mərhələlər yox",
                  loading["title"] == "Hesabat açılır…" and loading["loader"] and not loading["steps"] and not loading["lead"],
                  json.dumps(loading, ensure_ascii=False))
            await wait_for("!document.getElementById('view-results').hidden")

            # 2) Saylar bütün ekranlarda eyni (qısa nəticə, əhatə siyahısı, "Bütün tələblər" keçidi)
            tiles = await js("Object.fromEntries([...document.querySelectorAll('#sum-text .stat')].map(b=>[b.querySelector('.stat__title').textContent, {v: b.querySelector('.stat__value').firstChild.textContent, sub: b.querySelector('.stat__sub').textContent}]))")
            scope = await js("Object.fromEntries([...document.querySelectorAll('#scope-list li')].map(l=>[l.children[0].textContent, l.children[1].textContent]))")
            go = await js("document.getElementById('go-teleb-sub').textContent")
            req = (tiles.get("Tələblər") or {}).get("v", "")
            check("Nəticə blokunda tələb göstəricisi: tam / yoxlanılan", "/" in req, json.dumps(tiles, ensure_ascii=False))
            check("Göstərici ilə əhatə siyahısı eyni rəqəmləri verir",
                  req == scope.get("— cavablandırılıb", "?") + "/" + scope.get("— planın mətnində yoxlanılıb", "?"),
                  json.dumps(scope, ensure_ascii=False))
            heads = await js("""(()=>{const h=document.querySelector('.overview__headline').textContent;
              const cards=[...document.querySelectorAll('#fixes .fix, #fixes-more .fix')];
              const n=(c)=>cards.filter(f=>f.classList.contains('fix--'+c)).length;
              return {h, duzelis: n('kritik')+n('duzelis'), deq: n('deqiqlesdir')}})()""")
            want = [f"{heads['duzelis']} düzəliş" if heads["duzelis"] else "", f"{heads['deq']} dəqiqləşdirmə" if heads["deq"] else ""]
            check("Başlıqdakı saylar siyahıdakı kartlarla eynidir",
                  all(w in heads["h"] for w in want if w), json.dumps(heads, ensure_ascii=False))
            check("Nəticə blokunda 'əsasən … və s.' cümləsi və daxili qeydlər yoxdur",
                  not await js("/əsasən:|yenilənmiş qaydalarla|Eyni çatışmazlıq bir dəfə/.test(document.getElementById('sum-text').textContent + document.getElementById('sum-auto').textContent + document.getElementById('fix-sub').textContent)"))
            check("'Bütün tələblər' keçidində cəmi və ayrıca sənəd ayrıca yazılır",
                  go.startswith(scope.get("Standart tələblər — cəmi", "?") + " tələb") and "ayrıca sənəd yoxlanılmayıb" in go, go)
            check("Bölmə 'Yoxlamanın nəticəsi' adlanır, AI qeydi bir dəfə və qısa",
                  await js("document.getElementById('sum-title').textContent") == "Yoxlamanın nəticəsi"
                  and (await js("document.getElementById('sum-auto').textContent")).startswith(
                      "Avtomatik yoxlama nəticəsidir. İnsan tərəfindən təsdiqlənməyib."))
            check("Ümumi suallar və model rəyi əsas görünüşdə yoxdur",
                  not await js("/bilərmi\\?|Əsas tapıntılar|Aydınlaşdırılmalı/.test(document.getElementById('panel-xulase').textContent)"))
            fix = await js("""(()=>{const f=document.querySelector('#fixes .fix'); return f && {
              topic: f.querySelector('.fix__topic').textContent, rows: [...f.querySelectorAll('dt')].map(d=>d.textContent),
              src: !!f.querySelector('.fix__src')}})()""")
            check("Hər düzəliş: mövzu, nə çatışmır, nə etmək lazımdır, 'Mənbəyə bax'",
                  fix and {"Nə çatışmır", "Nə etmək lazımdır"} <= set(fix["rows"]) and fix["src"], json.dumps(fix, ensure_ascii=False))
            check("Möhür yoxdur — sadə status etiketi", await js("!document.querySelector('.stamp') && !!document.getElementById('res-status-label').textContent"))
            await shot("aydinliq-netice")

            # 7) "Ətraflı" düyməsi
            await js("document.getElementById('tab-maliyye').click()")
            await asyncio.sleep(0.3)
            label = await js("document.querySelector('#fin-body .fin__more').getAttribute('aria-label')")
            check("Hər maliyyə sətrində adlı 'Ətraflı' düyməsi", await js("document.querySelectorAll('#fin-body .fin__more').length")
                  == await js("document.querySelectorAll('#fin-body tr').length") and "ətraflı" in label, label)
            await shot("aydinliq-maliyye")

            # 4) Jurnal yoxdursa sıfır göstərilmir (demo — jurnal var; boş vəziyyəti saxta jurnalla yoxlayırıq)
            await js("document.getElementById('tab-agentler').click()")
            empty = await js("(()=>{AG.list=[]; renderAgents(); return {statsHidden: document.getElementById('ag-stats').hidden,"
                             " text: document.getElementById('ag-gantts').textContent}})()")
            check("Jurnal yoxdursa sıfır yox, 'icra məlumatı qeydə alınmayıb'",
                  empty["statsHidden"] and "qeydə alınmayıb" in empty["text"], json.dumps(empty, ensure_ascii=False))

            # 1) Əlavə tələblər: ayrıca sənəd gizlənmir, "hamısı" deyilmir
            await call("Page.navigate", url=f"{BASE}?demo=1&check={extra}&tab=xulase")
            await wait_for("document.querySelectorAll('#sum-text .stat').length >= 2")
            ex = await js("(()=>{const b=document.querySelector('#sum-text .stat--elave'); return b ? b.querySelector('.stat__sub').textContent + ' | ' + b.title : ''})()")
            check("Əlavə tələblər: ayrıca sənəd ayrıca yazılır, 'hamısı' deyilmir",
                  "ayrıca sənəd" in ex and "hamısı" not in ex, ex)

            # 6) Plan seçimi: eyni ad — yalnız təklif (test öz planını yaradır — boş bazada da işləsin)
            sys.path.insert(0, str(ROOT / "tests" / "ui"))
            from delete_ui import upload
            upload(f"Aydınlıq planı {int(time.time())}")
            await call("Page.navigate", url=BASE)
            await wait_for("document.querySelectorAll('#plan-select option').length > 1")
            name = await js("document.querySelector('#plan-select option:nth-child(2)').textContent.split(' · ')[0]")
            await js(f"(()=>{{const i=document.getElementById('plan-id'); i.value={json.dumps(name)}; i.dispatchEvent(new Event('input'))}})()")
            check("Eyni ad yazılanda yalnız təklif göstərilir, rejim 'Yeni plan' qalır",
                  await js("!document.getElementById('plan-suggest').hidden && "
                           "document.querySelector('input[name=plan-mode]:checked').value==='new'"))
            await shot("aydinliq-plan-teklif")
            await js("document.getElementById('plan-suggest-btn').click()")
            check("Təklif qəbul olunanda mövcud plan açıq seçilir",
                  await js("document.querySelector('input[name=plan-mode]:checked').value==='existing' && "
                           "!!document.getElementById('plan-select').value"))
            await shot("aydinliq-plan-movcud")
            check("Əsas axında xəbər tabı yoxdur", await js("!document.getElementById('mtab-news')"))
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)


asyncio.run(main())
