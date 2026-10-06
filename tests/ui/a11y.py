"""Klaviatura və fokus yoxlaması (CDP, real klaviş hadisələri).

    python tests/ui/a11y.py "http://127.0.0.1:8010/?demo=1&check=<id>&tab=xulase"
    python tests/ui/a11y.py "<demo url>" --econ "http://127.0.0.1:8010/?check=<id>&tab=iqtisadi"

`--econ` — iqtisadi təhlili aparılmış REAL (demo olmayan) yoxlama: "İqtisadi təhlil" və "Suallar və
sənədlər" tabları demo rejimində göstərilmir. Test heç nə dəyişdirmir (status seçilmir, sual
göndərilmir, fayl yüklənmir). Verilməsə, bu hissə SKIP kimi yazılır.
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

CHROME = os.getenv("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE = tempfile.mkdtemp(prefix="komite-chrome-")
PORT = 9335
KEYS = {"ArrowRight": 39, "ArrowLeft": 37, "End": 35, "Home": 36, "Tab": 9, "Escape": 27, "Enter": 13, "ArrowDown": 40}


async def main(url: str, econ_url: str | None = None) -> None:
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
                r = await call("Runtime.evaluate", expression=expr, returnByValue=True)
                return r["result"].get("value")

            async def key(name, shift=False):
                # Real klaviatura ardıcıllığı: Enter üçün "char" hadisəsi də (düymə məhz onunla aktivləşir).
                kinds = ("rawKeyDown", "char", "keyUp") if name == "Enter" else ("rawKeyDown", "keyUp")
                for kind in kinds:
                    extra = {"text": "\r"} if kind == "char" else {}
                    await call("Input.dispatchKeyEvent", type=kind, key=name, code=name,
                               windowsVirtualKeyCode=KEYS[name], modifiers=8 if shift else 0, **extra)
                await asyncio.sleep(0.15)

            def check(name, ok, detail=""):
                results.append(ok)
                print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

            await call("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
            await call("Page.navigate", url=url)
            await asyncio.sleep(3)

            await js("document.getElementById('tab-xulase').focus()")
            await key("ArrowRight")
            active = await js("document.activeElement.id")
            selected = await js("document.querySelector('#tabs [aria-selected=true]').id")   # bazar vidcetinin tabları da var
            check("ArrowRight növbəti taba keçir və seçir", active == selected == "tab-maliyye", f"{active}/{selected}")
            # Sığmayan tablar "Daha çox" menyusundadır — ox düymələri zolaqda GÖRÜNƏN tablar arasında.
            last = await js("[...document.querySelectorAll('#tabs .tab')].filter(t=>!t.hidden).slice(-1)[0].id")
            await key("End")
            check("End son görünən tab", await js("document.activeElement.id") == last, last)
            await key("Home")
            check("Home ilk tab", await js("document.activeElement.id") == "tab-xulase")
            await key("ArrowLeft")
            check("ArrowLeft dövr edir (son görünən taba)", await js("document.activeElement.id") == last)
            panel_ok = await js(f"!document.getElementById('{last.replace('tab-', 'panel-')}').hidden && document.getElementById('panel-xulase').hidden")
            check("Yalnız seçilmiş panel görünür", bool(panel_ok))
            tabindex = await js("[...document.querySelectorAll('#tabs .tab')].filter(t=>t.tabIndex===0).length")
            check("Roving tabindex: yalnız bir tab Tab sırasında", tabindex == 1, str(tabindex))
            check("Tab zolağında üfüqi scroll yoxdur",
                  await js("(()=>{const s=document.getElementById('tabs');return s.scrollWidth<=s.clientWidth+1})()"))
            menu = await js("document.getElementById('tabs-more-wrap').hidden ? 0 : document.querySelectorAll('#tabs-menu .tabsmore__item').length")
            if menu:
                await js("document.getElementById('tabs-more').focus()")
                await key("ArrowDown")
                check("'Daha çox' ArrowDown ilə menyunu açır, fokus elementə keçir",
                      await js("!document.getElementById('tabs-menu').hidden && document.activeElement.getAttribute('role')==='menuitemradio'"))
                check("'Daha çox' aria-expanded=true", await js("document.getElementById('tabs-more').getAttribute('aria-expanded')") == "true")
                await key("Escape")
                check("Escape menyunu bağlayır, fokus düyməyə qayıdır",
                      await js("document.getElementById('tabs-menu').hidden && document.activeElement.id==='tabs-more'"))

            # Detal paneli
            await js("document.getElementById('tab-maliyye').click()")
            await asyncio.sleep(0.3)
            await js("document.querySelector('#fin-body .fin__more').focus()")
            check("'Ətraflı' düyməsinin adı göstəricini bildirir",
                  "ətraflı" in (await js("document.querySelector('#fin-body .fin__more').getAttribute('aria-label')") or ""))
            await key("Enter")
            check("Enter 'Ətraflı' düyməsi ilə detal panelini açır", await js("!document.getElementById('detail').hidden"))
            check("Fokus panelə keçir", await js("document.activeElement.id") == "detail-close")
            check("Arxa fon inert", await js("document.querySelector('.shell').inert") is True)
            inside = True
            for _ in range(6):
                await key("Tab")
                inside = inside and await js("document.getElementById('detail').contains(document.activeElement)")
            check("Tab fokus panelin içində qalır (tələ)", inside)
            await key("Tab", shift=True)
            check("Shift+Tab da paneldə qalır",
                  await js("document.getElementById('detail').contains(document.activeElement)"))
            await key("Escape")
            check("Escape paneli bağlayır", await js("document.getElementById('detail').hidden"))
            check("Fokus 'Ətraflı' düyməsinə qayıdır", await js("document.activeElement.classList.contains('fin__more')"))
            check("Arxa fon yenidən aktivdir", await js("document.querySelector('.shell').inert") is False)

            # Mobil menyu
            await call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=1, mobile=True)
            await asyncio.sleep(0.4)
            await js("document.getElementById('menu-btn').click()")
            await asyncio.sleep(0.3)
            check("Mobil menyu açılır", await js("document.getElementById('sidebar').classList.contains('is-open')"))
            check("aria-expanded=true", await js("document.getElementById('menu-btn').getAttribute('aria-expanded')") == "true")
            check("Fokus menyuya keçir", await js("document.activeElement.id") == "nav-new")
            await key("Escape")
            check("Escape menyunu bağlayır", await js("!document.getElementById('sidebar').classList.contains('is-open')"))

            # Status yalnız rənglə deyil — mətn və işarə ilə
            text = await js("document.getElementById('res-status-label').textContent")
            sr = await js("document.querySelector('#res-status .sr-only').textContent")
            check("Status etiketində mətn var (yalnız rəng deyil)", bool(text) and "status" in sr.lower(), text)
            # Düzəliş siyahısı klaviatura ilə: "Mənbəyə bax" Enter ilə dəlil panelini açır
            await js("document.getElementById('tab-xulase').click()")
            await js("document.querySelector('#fixes .fix__src').focus()")
            await key("Enter")
            check("'Mənbəyə bax' Enter ilə dəlil panelini açır", await js("!document.getElementById('detail').hidden"))
            await key("Escape")
            check("Fokus 'Mənbəyə bax' düyməsinə qayıdır", await js("document.activeElement.classList.contains('fix__src')"))
            await js("document.querySelector('.finsum__more').focus()")
            await key("Enter")
            check("Maliyyə cədvəlində 'Ətraflı' Enter ilə açılır", await js("!document.getElementById('detail').hidden"))
            await key("Escape")
            no_inner = await js("!document.querySelector('script:not([src])')")
            check("Səhifədə inline skript yoxdur", bool(no_inner))

            if econ_url:
                await economics(call, js, key, check, econ_url)
            else:
                print("SKIP İqtisadi təhlil və Suallar tabları — --econ URL verilməyib (demo rejimində göstərilmir)")
    finally:
        proc.terminate()
    print(f"\n{sum(results)}/{len(results)} keçdi")
    sys.exit(0 if all(results) else 1)


async def economics(call, js, key, check, url: str) -> None:
    """İqtisadi təhlil və Suallar tabları: klaviatura, adlar, mətnlə status, cədvəl semantikası."""
    async def wait(expr, seconds=15):
        end = time.time() + seconds
        while time.time() < end:
            if await js(expr):
                return True
            await asyncio.sleep(0.3)
        return False

    await call("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
    await call("Page.navigate", url=url)
    ready = await wait("document.querySelectorAll('#econ-findings .efinding').length > 0")
    check("İqtisadi təhlil yükləndi (tapıntılar var)", ready)
    if not ready:
        return

    # Tab sırası: Maliyyə → İqtisadi təhlil, ox düymələri ilə
    await js("document.getElementById('tab-maliyye').click(); document.getElementById('tab-maliyye').focus()")
    await key("ArrowRight")
    check("ArrowRight: Maliyyədən sonra 'İqtisadi təhlil' tabı seçilir",
          await js("document.activeElement.id") == "tab-iqtisadi"
          and await js("!document.getElementById('panel-iqtisadi').hidden"))
    badge = await js("(()=>{const b=document.getElementById('count-iqtisadi');return b.textContent? b.title : 'boş'})()")
    check("Tab nişanının mənası tooltip-də", bool(badge) and ("bayraq" in badge or badge == "boş"), badge)

    # Risk və vəziyyət — mətnlə, canlı bölgə
    risk = await js("document.getElementById('econ-risk').textContent")
    check("Risk səviyyəsi mətnlə yazılır (yalnız rəng deyil)", "Risk səviyyəsi" in (risk or ""), (risk or "")[:60])
    check("Hesab vəziyyəti canlı bölgədədir (role=status)",
          await js("document.getElementById('econ-state').getAttribute('role')") == "status")

    # Süzgəc: düymə, aria-pressed, klaviatura
    await js("document.querySelectorAll('#econ-filters .chip')[1].focus()")
    await key("Enter")
    pressed = await js("[...document.querySelectorAll('#econ-filters .chip')].map(c=>c.getAttribute('aria-pressed')).join()")
    check("Süzgəc Enter ilə seçilir, aria-pressed yenilənir", pressed.split(",")[1] == "true" and pressed.count("true") == 1, pressed)
    unlabeled = await js("[...document.querySelectorAll('#econ-findings .efinding')].filter(f=>!(f.querySelector('.badge')||{}).textContent).length")
    check("Hər tapıntının statusu mətnlə (nişanda yazı var)", unlabeled == 0, str(unlabeled))
    upload = await js("[...document.querySelectorAll('#econ-findings .efinding .btn')].every(b=>(b.getAttribute('aria-label')||'').startsWith('Sənəd yüklə: '))")
    check("'Sənəd yüklə' düymələrinin adı tapıntını bildirir", bool(upload))
    sem = await js("""(()=>{const t=document.getElementById('econ-sens-table'); if(!t||document.getElementById('econ-sens').hidden) return 'yox';
      return [!!t.querySelector('caption'), [...t.querySelectorAll('thead th')].every(h=>h.scope==='col'),
              [...t.querySelectorAll('tbody th')].every(h=>h.scope==='row'),
              [...document.querySelectorAll('.tornado__track')].every(x=>x.getAttribute('aria-hidden')==='true'),
              [...document.querySelectorAll('.tornado__value')].every(x=>x.textContent.trim())].join()})()""")
    check("Həssaslıq cədvəli: caption, scope; tornado yalnız bəzək, rəqəm mətnlə", sem in ("true,true,true,true,true", "yox"), sem)

    # Tapıntıdan suala keçid — Enter, fokus suala
    await js("document.querySelector('#econ-findings .fix__inline').focus()")
    await key("Enter")
    await asyncio.sleep(0.3)
    check("'Suallar tabında' Enter ilə suala keçir, fokus suala düşür",
          await js("!document.getElementById('panel-suallar').hidden && document.activeElement.classList.contains('q')"),
          await js("document.activeElement.id"))

    # Suallar: status seçiminin etiketi, süzgəc, əlavə formu
    labels = await js("[...document.querySelectorAll('#q-list select')].every(s=>{const l=document.querySelector('label[for=\"'+s.id+'\"]');return l&&l.textContent.trim()})")
    check("Hər sualın status seçiminin etiketi var", bool(labels))
    check("Sual süzgəcləri aria-pressed ilə",
          await js("[...document.querySelectorAll('#q-filters .chip')].every(c=>c.hasAttribute('aria-pressed'))"))
    await js("document.getElementById('q-add-btn').focus()")
    await key("Enter")
    check("'Sual əlavə et' Enter ilə formu açır, fokus mətn sahəsinə keçir",
          await js("!document.getElementById('q-add').hidden && document.activeElement.id==='q-add-text'"))
    check("Yeni sualın sahəsi və sənəd seçimləri etiketlidir",
          await js("!!document.querySelector('label[for=\"q-add-text\"]') && !!document.querySelector('#q-add legend') && document.querySelectorAll('#q-add-docs label input').length > 0"))
    await js("document.getElementById('q-add-cancel').focus()")
    await key("Enter")
    check("'Ləğv et' formu bağlayır, fokus düyməyə qayıdır",
          await js("document.getElementById('q-add').hidden && document.activeElement.id==='q-add-btn'"))

    # Sənəd forması: etiketlər, fayl seçimi klaviaturadan əlçatandır
    check("Sənəd növü və tələb seçimlərinin etiketi var",
          await js("!!document.querySelector('label[for=\"ev-doc-type\"]') && !!document.querySelector('label[for=\"ev-req\"]')"))
    await js("document.getElementById('ev-file').focus()")
    check("Fayl seçimi Tab ilə fokuslanır və görünən fokus alır",
          await js("document.activeElement.id==='ev-file' && getComputedStyle(document.querySelector('.evform__file')).outlineStyle !== 'none'"))
    check("Məktub keçidinin adı var", bool((await js("document.getElementById('q-letter').textContent") or "").strip()))
    dels = await js("[...document.querySelectorAll('#ev-list .btn')].every(b=>(b.getAttribute('aria-label')||'').startsWith('Sənədi sil: '))")
    check("Sənədin 'Sil' düyməsinin adı faylı bildirir", bool(dels))

    # Nəticə tabındakı sətir → İqtisadi təhlil (Enter)
    await js("document.getElementById('tab-xulase').click()")
    await js("document.querySelector('#sum-econ a').focus()")
    await key("Enter")
    check("Nəticə tabındakı 'Ətraflı' Enter ilə İqtisadi təhlil tabını açır",
          await js("!document.getElementById('panel-iqtisadi').hidden && document.activeElement.id==='tab-iqtisadi'"))

    # Mobil: üfüqi daşma yoxdur
    await call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=1, mobile=True)
    await asyncio.sleep(0.4)
    for tab in ("iqtisadi", "suallar"):
        await js(f"document.getElementById('tab-{tab}').click()")
        await asyncio.sleep(0.3)
        width = await js("document.documentElement.scrollWidth")
        check(f"390 px: '{tab}' tabında üfüqi daşma yoxdur", width <= 390, str(width))


if __name__ == "__main__":
    args = sys.argv[1:]
    econ = None
    if "--econ" in args:
        i = args.index("--econ")
        econ = args[i + 1]
        del args[i:i + 2]
    asyncio.run(main(args[0], econ))
