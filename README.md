# Biznes Plan qiymətləndirmə komitəsi

Biznes planı qiymətləndirən multi-agent veb tətbiq (Python · FastAPI · LangGraph · vanilla JS).
Planın `.docx` faylı yüklənir və tətbiq yoxlayır:

1. **Tələblər** — standart tələblər siyahısının hər bəndi planda cavablanıbmı; istəyə bağlı
   olaraq yüklənən **əlavə tələb sənədlərinin** (bank, fond və s.) bəndləri də;
2. **Maliyyə** — planda bəyan edilən rəqəmlər bir-birinə uyğundurmu (**Python** yenidən hesablayır);
3. **Doldurulmamış yerlər** — `[VÖEN]`, `[tarix]` kimi;
4. **Versiyalar** — eyni planın əvvəlki versiyası ilə nə dəyişib;
5. **İqtisadi təhlil** — ayrıca nəticə: planın öz rəqəmləri arasında məntiqi uyğunluq, həssaslıq
   (kodun hesabı), bazar göstəriciləri ilə tutuşdurma, risk səviyyəsi, ərizəçiyə suallar və tələb olunan
   sənədlər; yüklənən əlavə sənədlərin (Excel modeli, təklif, niyyət məktubu) yoxlanması.

> Bu, **investisiya qərarı deyil.** Hazırlıq statusu ("Hazır deyil" / "Düzəliş lazımdır") yalnız sənədin
> tamlığı və daxili uyğunluğudur — uyğun gələn mənfi NPV də orada "uyğun"dur. İqtisadi risk **ayrıca**,
> "İqtisadi təhlil" tabında göstərilir və hazırlıq statusunu dəyişmir.

> Tələblər siyahısı (`data/requirements.json`) layihənin **öz ümumi siyahısıdır** — heç bir
> qurumun rəsmi tələblərinin surəti deyil və rəsmi standartla tutuşdurulmayıb. Konkret qurum
> üçün istifadə olunarsa, əvvəlcə onun rəsmi siyahısı ilə uyğunlaşdırın.

## Əsas prinsiplər

- **LLM rəqəm hesablamır.** Model rəqəmin sənəddə harada olduğunu tapır; bütün hesablamalar Python-dadır.
- **Hər rəqəm öz mənbəyində yoxlanılır.** Model rəqəmlə birlikdə yer (bölmə/cədvəl), hərfi sitat,
  vahid və ssenari qaytarır; Python sitatın həmin yerdə olduğunu, göstəricinin adını və ona ən yaxın
  rəqəmin **işarəsi ilə** eyni olduğunu yoxlayır. Başqa göstəricinin və ya başqa ssenarinin rəqəmi qəbul edilmir.
- **Məlumat çatmırsa — "yoxlanıla bilmədi".** Boş xana sıfır sayılmır, rəqəm uydurulmur, qismən
  yoxlama "uyğun" deyil, qismən əhatə "hazır" deyil.
- **Yekun status deterministikdir** — qayda ilə, modelin fikri deyil. Rəy başlığı da statusdan qurulur.
- **Sənəd mətni məlumatdır, təlimat deyil.** Əlavə sənədlərdəki "əvvəlki təlimatları unut" kimi mətn agentin davranışını dəyişmir.
- **API açarları yalnız backend-də** (`.env`). Frontend-ə, cavablara və loglara çıxmır.

## Quraşdırma və işə salma

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            # (Linux/macOS: cp) — sonra açarı yazın
```

`.env` — ən azı model və açar:

```ini
LLM_MODEL=anthropic:claude-sonnet-5        # və ya google_genai:gemini-2.5-pro
ANTHROPIC_API_KEY=...
LANGSMITH_TRACING=true                      # istəyə bağlı
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=biznes-plan-komite
COMPLIANCE_GROUPS=                          # boş — bütün qruplar; naməlum ad konfiqurasiya xətasıdır
DEV_MODE=                                   # 1 — yükləmədə "süni xəta" seçimi (retry-ni sınamaq üçün)
ECONOMICS_AUTO=1                            # 0 — iqtisadi təhlil yalnız düymə ilə (əks halda yoxlamadan sonra, +1 model çağırışı)
```

İşə salma (8000 portunda başqa layihə ola bilər — **8010** istifadə edin):

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8010
# http://127.0.0.1:8010
```

Real API olmadan:

| Nə | Əmr | Qeyd |
| --- | --- | --- |
| Demo interfeys | `python scripts/make_demo.py` → `http://127.0.0.1:8010/?demo=1` | Saxta model, sintetik nəticə; hər ekranda **Demo**; heç nə göndərilmir, tarixçəyə yazılmır |
| Saxta modelli server | `python scripts/fake_server.py` → `http://127.0.0.1:8011` | Tam axın (yükləmə, təsdiq, retry) ödənişli API-siz; müvəqqəti məlumat qovluğu |
| Demo DOCX faylları | `python scripts/make_samples.py input/CFG_Biznes_Plan_ilkin.docx` | `samples/` (anonim demo planlar) |

## Əlavə tələb sənədləri

Yükləmə ekranında iki sahə var: **A. Biznes plan** (məcburi, bir DOCX) və **B. Əlavə tələb sənədləri**
(istəyə bağlı). Əlavələr standart siyahını **əvəz etmir**, əlavə meyar yaradır.

| | |
| --- | --- |
| Formatlar | mətnli **PDF**, **DOCX**, **TXT** (UTF-8); həmçinin mətn sahəsinə yazılmış tələblər |
| Limitlər | ən çoxu **10 fayl**, hər fayl **10 MB**, cəmi **30 MB**, mətn sahəsi **20 000 simvol** (yükləmədən əvvəl göstərilir) |
| Skan PDF | OCR **yoxdur** → "Mətn çıxarıla bilmədi; mətnli PDF, DOCX və ya TXT yükləyin" (oxunmuş kimi göstərilmir) |
| Saxlama | daxili ad (`uuid`) ilə `data/uploads/elave/`; istifadəçinin fayl adı yol kimi işlənmir; SHA-256 izi saxlanılır |

Axın:

1. Plan və əlavələr qəbul edilir, əlavələrin mətni istinadla çıxarılır (`səh. 3`, `bölmə: …`, `abzas 2`).
2. Model **yalnız** tələb bəndlərini strukturlaşdırır — status vermir. Hər bəndin fraqmenti çıxarılmış
   mətnlə tutuşdurulur; mənbədə olmayan bənd səbəbi ilə "qəbul edilməyənlər"ə düşür.
3. İstifadəçi siyahını nəzərdən keçirir: redaktə, silmə, əlavə, təsdiq.
4. **Yalnız təsdiqdən sonra** tam yoxlama başlayır. Təsdiqlənmiş siyahı versiyası ilə saxlanılır;
   retry onu modelə yenidən yaratdırmır.

Əlavə yoxdursa, yoxlama əvvəlki kimi dərhal başlayır. Hər əlavə tələbin sabit ID-si, mətni, mənbə
faylı, istinadı, dəqiq fraqmenti, növü (`plan` / `sened`) və təsdiq vəziyyəti var.

**ID və versiya müqayisəsi:**

- Model çıxardığı bəndin ID-si **məzmundan** qurulur: mənbə faylın SHA-256 izi + fraqment +
  normallaşdırılmış mətn + növ → `E` + 12 onaltılıq simvol. Fayl adı ID-yə təsir etmir, eyni giriş
  həmişə eyni ID verir. Bir abzasdan çıxan **fərqli** tələblər ayrı saxlanılır, **tam eyni** bəndin
  təkrarı isə birləşdirilir. İstifadəçinin əlavə etdiyi bənd `EU…` ID-si alır.
- Təsdiqlənmiş siyahı ID-ləri ilə saxlanılır və **geriyə dönük dəyişdirilmir**. Köhnə yoxlamalarda
  6 simvollu ID-lər olduğu kimi qalır.
- İstifadəçi təsdiq ekranında mətni **redaktə edərsə**, ID dəyişmir (`edited=True`). Növbəti
  versiya ilə müqayisədə mətni fərqlənən eyni ID **"tələb dəyişdi"** kimi göstərilir.
- Mənbə sənəddə tələbin **mətni dəyişibsə**, fraqment də dəyişir və bənd yeni ID alır. Müqayisədə
  bu, **"tələb çıxarıldı" + "tələb əlavə edildi"** kimi görünür, "dəyişdi" kimi yox: ID məzmundan
  qurulduğu üçün sistem iki fərqli mətnin "eyni tələb" olduğunu iddia etmir.
- Bunların heç biri planın yaxşılaşması və ya pisləşməsi sayılmır.

**Limitlər səssiz tətbiq olunmur:**

- Böyük sənəd **hissə-hissə** emal olunur: hər model çağırışına ≤ 60 000 simvol, ən çoxu 4 hissə.
  Ondan artıq mətn modelə verilmir — "mətnin kəsilməsi" kimi ayrıca bildirilir. Tam əhatə üçün
  sənədi kiçik fayllara bölüb ayrı yoxlamalarda yükləyin.
- Siyahıda ən çox **100** bənd saxlanılır. Alınan, saxlanılan və kənarda qalan bəndlərin sayı, eləcə
  də kənarda qalan bəndlərin özləri təsdiq ekranında göstərilir. Model limitə çatanda da xəbərdarlıq
  çıxır, çünki sənəddə daha çox tələb ola bilər.
- Siyahı natamamdırsa, istifadəçi bunu açıq qəbul etmədən təsdiq mümkün deyil
  (`acknowledge_incomplete`). Bu xəbərdarlıq nəticənin "Əlavə tələblər" tabında da qalır.
Nəticədə **"Əlavə tələblər"** tabında tələb sənədindəki mənbə ilə biznes plandakı cavab yan-yana göstərilir.

## Yükləmə limitləri necə tətbiq olunur

Biznes plan **25 MB**-a qədər ola bilər. Əlavə fayllar üçün limitlər: ən çoxu 10 fayl, hər fayl 10 MB,
cəmi 30 MB, mətn 20 000 simvol. Limitlər üç qatda yoxlanılır.

1. **Gövdə həddi** (`BodyLimitMiddleware`, `app/main.py`).
   - Həddi bütün limitlərin cəmidir, üstəlik multipart başlıqları üçün 1 MB; digər sorğular üçün 2 MB.
   - Baytlar **həqiqətən gəldikcə** sayılır. Hədd aşılan kimi oxuma kəsilir və **413** qaytarılır.
   - `Content-Length`-ə etibar edilmir. Başlıq açıq-aşkar böyük ölçü göstərirsə, sorğu oxunmadan
     rədd edilir. Kiçik ölçü göstərib böyük gövdə göndərilsə də baytlar sayılır və oxuma kəsilir.
2. **Endpoint-də ucuz yoxlamalar**, heç bir fayl oxunmadan: plan adı, uzantı, fayl sayı, mətnin
   uzunluğu, test rejimi.
3. **Hissə-hissə oxuma** (256 KB-lıq hissələrlə).
   - Bütöv fayl yaddaşa yığılmır, oxuma həddən 1 bayt artıq olanda dayanır.
   - Hər əlavə faylın oxuma həddi tək fayl həddi ilə ümumi həddə qalan həcmin kiçiyidir.
   - Ümumi hədd aşılırsa, sorğu növbəti faylı oxumadan rədd edilir.
   - Tək fayl həddi aşılırsa, fayl siyahıda "xəta" kimi qalır və diskə yazılmır.

**Yarımçıq qeyd qalmır.** Yoxlama qeydi (`storage.create`) yalnız bütün yoxlamalardan sonra
yaradılır, ilkin vəziyyəti ilə birlikdə bir əməliyyatda. Ondan sonrakı istənilən xətada qeyd
silinir (`storage.discard`), diskə yazılmış fayllar da silinir. Bütün `UploadFile`-lar həmişə
bağlanır (`finally`), bununla Starlette-in müvəqqəti faylları da silinir.

**Multipart qorumasının hədləri (açıq deyirik):**

- Starlette multipart gövdəni endpoint işə düşməzdən **əvvəl** təhlil edir və faylları müvəqqəti
  diskə yazır (1 MB-dan sonra). Ona görə hədd daxilindəki gövdə endpoint-dəki limitlərdən əvvəl
  müvəqqəti diskə düşür. Qat 1 bunun həcmini məhdudlaşdırır, tam qarşısını almır.
- Starlette-in öz limitləri dəyişdirilməyib: hər mətn sahəsi 1 MB, ən çoxu 1000 sahə və 1000 fayl.
- Yavaş göndərilən gövdəyə (slowloris) qarşı vaxt limiti yoxdur.
- İstehsalda bunlar tərs proksidə də qoyulmalıdır: nginx-də `client_max_body_size 60m;`,
  `client_body_timeout` və sorğu sürəti limiti.
- Testlər: `tests/test_upload_limits.py`. Limitlər KB səviyyəsinə endirilir və oxunan baytlar,
  bağlanan fayllar, bazadakı qeydlər və diskdəki fayllar sayılır.

## Yeni interfeys, AI köməkçi və bazar icmalı

Görünüş istifadəçinin təsdiqlədiyi maketlərə uyğun qurulub: isti-boz fon, ağ kartlar, meşə yaşılı vurğu,
vahid sans-serif şrift (Inter, sistem şriftinə keçidlə).
Maketlər `docs/maket/`-də, bitmiş ekranların görüntüləri `docs/screenshots/yeni-dizayn/`-dədir.

**Yükləmə ekranı:**
- başlıq "Biznes planınızı yoxlayın";
- mərhələ göstəricisi **Sənəd → Tələblər → Hesabat**:
  - vəziyyət real axından gəlir;
  - əlavə tələb yoxdursa, "Tələblər" addımı "əlavə tələb yoxdur" kimi ötürülür;
  - faiz və vaxt göstərilmir;
- plan adı və böyük yükləmə sahəsi;
- **Əlavə tələblər** açılıb-bağlanan bölmədədir:
  - fayl və ya xəta varsa, başlıqda xülasə görünür ("1 fayl · 1 xəta");
  - xətalı fayl əlavə ediləndə bölmə avtomatik açılır, heç nə gizli qalmır;
- sağda **"Hesabatda nə olacaq?"** bloku;
- "Növbəti addım" mətni axına uyğundur: əlavə varsa, "tələblərin təsdiqi".

**Sol panel bir ekrana sığır (1440×900, testlə yoxlanılır):**
- "Yeni yoxlama" — aktiv bənd vurğu zolağı ilə;
- "Planlar və versiyalar" — say nişanı ilə (nişan siyahıdakı plan sayıdır, tooltip: "4 plan"), yığıla bilir:
  - hər plan **bir sətirdir**: status nöqtəsi, ad, versiya nişanı;
  - statusun mətni ekran oxuyucu üçün yazılır və üzərinə gələndə görünür;
  - açıq plan vurğulanır;
  - siyahı sıxılmır və kəsilmir: plan və versiya sətirləri həmişə tam görünür, uzun siyahıda
    bütün sol panel sürüşür;
- **Bazar icmalı default yığılıb** (`<details>`): yoxlama işinə aid deyil, diqqəti yayındırmır. Açılanda
  tablı vidcetdir (Valyuta | Əmtəə, ox düymələri ilə; xəbərlər ayrıca açılan blokda):
  - sətirlər simvol, ad və dəyişmə istiqaməti ilə göstərilir;
  - mənbə və tarix vidcetin altında yazılır;
- "Kömək mərkəzi" və qeyd panelin altına bərkidilib; "Kömək mərkəzi" AI köməkçini açır.

**Hərəkət sakit və birdəfəlikdir** (`prefers-reduced-motion`-da söndürülür):
- başlıq, faktlar ("47 standart tələb · 11 qrup · 7 maliyyə yoxlaması" — `/api/meta`-dan) və kartlar
  ardıcıl görünür;
- mərhələ xətti dolur, tamamlanan addımın işarəsi "çəkilir";
- yükləmə sahəsi sürükləməyə cavab verir və mətnlə bildirir ("Buraxın — fayl qəbul ediləcək");
- fayl qəbul olunanda işarə çəkilir, "Davam et" hazır olanda bir dəfə parıldayır;
- illüstrasiya görünəndə canlanır, bazar rəqəmləri ilk yükləmədə sayılaraq gəlir.

Server başlayanda bazar keşi fonda doldurulur, ona görə vidcet ilk açılışda gözlətmir.

**Nəticə ekranı:**
- **başlıq kartı:** yuxarıda statusa uyğun rəngli zolaq və yumşaq çalar var. Status sadə etiketdə mətnlə
  yazılır, rəng yalnız əlavədir. Yanında "Yoxlama tamamlandı · tarix" — tarix **bir dəfə** göstərilir.
  Fayl adı və versiya ikonlu nişanlarda, bir sətirdədir (lazım olsa sətrə keçir). Əməliyyatlar:
  "Hesabatı çap et" və "Yeni versiya yüklə" (plan adı avtomatik doldurulur); 1200 px-dən dar ekranda
  düymələr nişanların altına keçir ki, fayl adı sıxılıb qırılmasın;
- **tablar** seqment panelindədir və sürüşəndə yuxarıda yapışqan qalır (mobildə üst panelin altında).
  Nişan problem sayıdır, mənası tooltip-dədir ("9 natamam tələb", "1 dəqiqləşdirmə", "8 doldurulmamış
  yer"). Əlavə tələb yoxdursa, nişan boz "0"-dır ("Əlavə tələb yoxdur");
- **tab zolağında üfüqi scrollbar yoxdur** — sığmayan tablar "Daha çox ▾" menyusuna keçir
  (`layoutTabs`, `static/app.js`). Mərhələlər, hər birində zolağın sığması ölçülür: (1) tam adlar;
  (2) qısa adlar ("İqtisadi", "Tələblər", "Əlavə", "Suallar"); (3) Agentlər → Müqayisə → Əlavə tələblər
  menyuya; (4) sıx tablar; (5) "Daha çox" yalnız ikon; (6) dar ekranda zolaqda yalnız aktiv tab, qalanı
  menyuda. **Nişanında problem sayı olan tab menyuya düşmür.** Aktiv tab menyudadırsa, düymədə onun adı
  görünür. Nəticə: 1280 px — 7 tab + menyuda Müqayisə, Agentlər; 974 px — 6 əsas tab (Nəticə, Maliyyə,
  İqtisadi təhlil, Standart tələblər, Boş yerlər, Suallar) + menyuda 3; 375 px — aktiv tab + menyu.
  Tablar DOM-da qalır — `?tab=…` (menyudakı tablar da) əvvəlki kimi açılır. Ox düymələri zolaqda görünən
  tablar arasında; menyu: ArrowDown açır, ↑/↓, Home/End, Escape bağlayır və fokusu düyməyə qaytarır.
  Zolaq şrift yüklənəndə, en və nişan dəyişəndə yenidən yerləşir;
- **yapışqan zolaq kontenti örtmür:** zolağın faktiki alt sərhədi `--tabs-h`-də (JS ölçür). Maliyyə,
  Standart tələblər, İqtisadi təhlil və Suallar tablarının filtr sətirləri (`.stickyrow`) zolağın
  **altında** `top: var(--tabs-h)` ilə yapışır (≥ 601 px; mobildə ekranı tutmasın deyə adi axında).
  Keçidlərin hədəfi (düzəliş kartı, tapıntı, sual, bölmə) `scroll-margin-top: calc(var(--tabs-h) +
  var(--filters-h) + 12px)` alır — "Ən vacib 3 düzəliş" və "Suallar tabında" keçidləri başlığı zolağın
  altında qoymur;
- **"Nəticə" tabı** — status, saylar və düzəliş siyahısı bir mənbədən qurulur; ətraflı:
  [Nəticə tabı: saylar və düzəliş kartları](#nəticə-tabı-saylar-və-düzəliş-kartları). Bir sətirlə
  iqtisadi təhlilin xülasəsi də var: "İqtisadi təhlil: yüksək risk · 12 açıq sual · Ətraflı";
- **"İqtisadi təhlil"** (Maliyyədən sonra) və **"Suallar və sənədlər"** tabları — ətraflı:
  [İqtisadi təhlil](#i̇qtisadi-təhlil).

**Mobil:**
- sol menyu yığılır;
- "Davam et" formanın altında yapışqandır;
- AI köməkçinin girişi üst panelin küncündədir ki, əsas düyməni örtməsin.

**AI köməkçi düyməsi mətni örtmür:** 861–1399 px enində düymə yığcam dairəyə çevrilir (ad ekran oxuyucu
üçün qalır), hesabatın sağında və altında boşluq var. Daha geniş ekranda hesabat mətni düymədən
solda bitir.

### Bazar icmalı (`app/market.py`, `GET /api/market`)

| Blok | Mənbə | Açar | Qeyd |
| --- | --- | --- | --- |
| USD/AZN, EUR/AZN, TRY/AZN | AR Mərkəzi Bankının gündəlik XML bülleteni | lazım deyil | bülletenin tarixi ayrıca göstərilir; 1 vahid üçün (nominal nəzərə alınır) |
| Qızıl | eyni bülleten (XAU) | lazım deyil | AZN, **1 troya unsiyası**; dəyişmə əvvəlki bülletenlə müqayisədir |
| AAPL | Alpha Vantage `GLOBAL_QUOTE` | `ALPHAVANTAGE_API_KEY` | USD, **son ticarət günü** (real vaxt deyil) |
| Brent | Alpha Vantage `BRENT` (gündəlik) | `ALPHAVANTAGE_API_KEY` | USD, **1 barel**, tarix ilə |
| 2 maliyyə xəbəri | Alpha Vantage `NEWS_SENTIMENT` (financial_markets) | `ALPHAVANTAGE_API_KEY` | başlıq, mənbə, vaxt, keçid (yalnız http/https) |

- **Keş:** CBAR 1 saat, AAPL 30 dəqiqə, Brent 6 saat, xəbərlər 1 saat. Alpha Vantage-in pulsuz limiti
  azdır, ona görə sorğular seyrəkdir.
- **Vaxt limiti:** `MARKET_TIMEOUT`, susmaya görə 6 saniyə.
- **Sürət limiti:** pulsuz Alpha Vantage tarifi ardıcıl sorğuları rədd edir, ona görə sorğular arasında
  ən azı 1,1 saniyə fasilə var (`AV_MIN_INTERVAL`).
- **Mənbə cavab verməyəndə** son uğurlu məlumat "köhnəlmiş" kimi göstərilir. Heç biri yoxdursa,
  "Məlumat mövcud deyil" yazılır.
- **Açar yoxdursa,** "Mənbə qoşulmayıb" yazılır, rəqəm uydurulmur.
- **Demo rejimində** maketdəki rəqəmlər **"Nümunə"** işarəsi və "canlı deyil" qeydi ilə göstərilir.
- **Bazar mənbələri düşsə də,** sənəd yoxlaması işləyir (testlə yoxlanılır).
- **Açarsız, maliyyə mövzulu xəbər lenti tapılmadı:** CBAR-ın RSS-i yoxdur, Report.az-ın kateqoriya
  lenti 404 verir. Ona görə xəbərlər də Alpha Vantage açarından asılıdır.

### AI köməkçi (`app/chat.py`, `POST /api/chat`, `GET /api/chat/status`)

- **Açılma:** sağ aşağıdakı düymə ilə və ya "Kömək mərkəzi" ilə açılır, özbaşına açılmır.
- **Panel:** başlıq, kiçilt/bağla, kontekst nişanı, hazır suallar, söhbət, yazı sahəsi.
  - hazır suallar: "Planı necə hazırlayım?", "Nələri yoxlayırsınız?"; nəticə varsa, "Hesabatı izah et";
  - Escape paneli bağlayır, fokus düyməyə qayıdır.
- **Model:** rəy agentləri ilə eyni konfiqurasiya (`LLM_MODEL`). Yeni provayder və asılılıq yoxdur.
  Açar yalnız backend-dədir. Açar yoxdursa, panel bunu açıq yazır. Demo rejimində model çağırılmır.
- **Kontekst serverdə, seçilmiş check ID ilə qurulur:**
  - nəticə (status, səbəblər, maliyyə yoxlamaları, problemli tələblər, boş yerlər);
  - sənədin bölmə siyahısı və bölmə/cədvəl mətnləri, büdcə daxilində: `CHAT_CONTEXT_CHARS`,
    problemlərin istinad etdiyi bölmələr birinci gəlir.

  Brauzerin göndərdiyi "nəticə" sahələri nəzərə alınmır. Sənəd seçilməyibsə, köməkçi ümumi biznes plan
  köməyi verir və sənədi oxumuş kimi danışmır.
- **Söhbətlər ayrıdır:** hər yoxlama üçün ayrı söhbət var, sənəd seçilməyəndə də ayrı. Cavab gəlməmiş
  başqa plana keçilsə, cavab öz söhbətinə yazılır.
- **Prompt injection:** sənəd və nəticə ayrıca məlumat bloklarındadır, təlimat kimi işlənmir. Mətndə
  blokun bağlanış teqini təqlid edən hissə zərərsizləşdirilir.
- **Sistem təlimatı:** status dəyişdirilmir, investisiya qərarı verilmir, rəqəm uydurulmur. İstinad bölmə
  və cədvəl id-si ilə verilir, səhifə nömrəsi uydurulmur.
- **Limitlər:**
  - sual 1500 simvol;
  - son 8 mesaj, hər biri 4000 simvol;
  - vaxt limiti `CHAT_TIMEOUT`;
  - eyni anda `CHAT_CONCURRENCY` sorğu (429), brauzerdə bir anda bir sorğu.
- **Xətalar:** provayder xətasının mətni (açar, sorğu detalları) nə cavaba, nə loga düşür. Logda yalnız
  xəta növü qalır. Brauzerdə "Yenidən cəhd et" düyməsi var.
- **Görünüş:**
  - başlıqda canlı vəziyyət nişanı ("Hazır", "Cavab yazır…", "Qoşulmayıb", demoda "model çağırılmır");
  - loqolu xoş gəldin kartında köməkçinin real imkanları yazılıb (kontekstə görə dəyişir);
  - hazır suallar yazı sahəsinin üstündə daim əlçatandır;
  - mesajların vaxtı var, kopyalayanda "Kopyalandı ✓" görünür;
  - yazı sahəsi məzmuna görə böyüyür, altda klaviatura ipucu var.
- **Cavabların göstərilməsi:** yalnız `textContent` ilə. "1. …" və "- …" sətirləri siyahıya çevrilir.
  Cavabı kopyalamaq olur.

## Semantik yaddaş, açıq handoff və LangSmith

### Semantik yaddaş (`app/memory.py`, `app/embeddings.py`)

LangGraph-ın `SqliteStore`-u vektor indeksi ilə (`sqlite-vec`) işlədilir. Fayl
`DATA_DIR/memory-<rejim>-<ölçü>.db`-dir; restartdan sonra da qalır.

| Ad sahəsi | Nə saxlanılır | Kim istifadə edir |
| --- | --- | --- |
| `("sened", <sənəd heşi>)` | bölmə parçaları (~1200 simvol, üst-üstə düşmə ilə) və cədvəllər, istinadla | qrafın agentləri (`search_document` aləti), AI köməkçi (`sened_axtar`) |
| `("tapinti", <plan heşi>)` | planın **bütün versiyalarının** tələb və maliyyə tapıntıları | AI köməkçi (`evvelki_versiyalar`) — "əvvəlki versiyada bu problem var idimi?" |

- **Açar sənədin məzmun heşidir:** eyni sənəd bir dəfə vektorlaşdırılır.
- **Yaddaş yoxlama bitəndə yazılır.** Xətası (şəbəkə, açar) yoxlamanı və statusu pozmur, bu testlə
  yoxlanılır.
- **Embeddings rejimi** (`EMBEDDINGS_PROVIDER`):
  - `GOOGLE_API_KEY` varsa: Gemini `models/gemini-embedding-001` (768 ölçü), çoxdilli və semantik;
  - yoxdursa: **lokal leksik** rejim, söz, kök (4 və 6 hərf) və hərf üçlüklərinin heşi, Azərbaycan dili
    stop-sözləri ilə. Model yükləmir və açar istəmir, amma **semantik model deyil**: sinonimləri tapmır.
    Rejim AI köməkçinin altında açıq yazılır.
- **Faktiki müqayisə** (`plan_demo_v1.docx`, 5 oktyabr 2026):

  | Sorğu | Leksik (1-ci nəticə) | Google embeddings (1-ci nəticə) |
  | --- | --- | --- |
  | "layihə hansı riskləri daşıyır" | S4 (təşəbbüskar) — **səhv** | S47 "Ssenarilər üzrə risklərin qiymətləndirilməsi" ✓ |
  | "işçilərin sayı və əmək haqqı" | S30 "Əməyin ödənişi xərcləri" ✓ | S30 ✓ |
  | "kredit borcunun qaytarılması" | S28 "İnvestisiyanın həcmi və mənbələri" ✓ | S28 ✓ |
- **Köhnə yoxlamalar:** yaddaşdan əvvəl aparılmış yoxlamaların sənədi ilk axtarışda indekslənir. Onların
  tapıntıları isə planın yaddaşına yazılmayıb, yalnız yeni yoxlamaların tapıntıları yazılır.

### Açıq handoff — AI köməkçi komandası (`app/chat.py`)

Köməkçi bir LangGraph `StateGraph`-dır, hər üzv `create_agent`-dir:

```
            ┌─ transfer_to_maliyye_eksperti ─▶ maliyye_eksperti  (maliyye_yoxlamalari, sened_axtar, evvelki_versiyalar)
triaj ──────┤
(bələdçi)   └─ transfer_to_teleb_eksperti ───▶ teleb_eksperti    (telebler, bos_yerler, sened_axtar, evvelki_versiyalar)
```

- **Triaj necə ötürür:** sualı alət çağırışı ilə ötürür —
  `Command(goto=<agent>, graph=Command.PARENT)` (açıq handoff, şərti marşrut deyil). Ümumi suala özü
  cavab verir.
- **Cavabda hansı agentlərin işlədiyi qaytarılır** (`agents`), UI bunu göstərir:
  "Maliyyə eksperti · Bələdçi → Maliyyə eksperti".
- **Bütün alətlər serverdə check ID-yə bağlıdır.** Alətlərin nəticələri zərərsizləşdirilmiş məlumat
  bloklarındadır (`<yoxlama_neticesi>`, `<sened_parcalari>`).
- **Qorunan şərtlər:** limitlər, vaxt limiti, paralel sorğu nəzarəti və provayder xətasının gizlədilməsi
  əvvəlki kimidir; addım limiti 14-dür.

### LangSmith

- **İzləmə:**
  - yoxlama izi: ad `Komitə: <plan> v<N>`, teqlər, metadata (`check_id`, `plan_id`, `version`, `file_name`);
  - AI köməkçi izi: `AI köməkçi`, teq `ai-komekci`;
  - əlavə tələb çıxarışı: `Əlavə tələblər: <plan> v<N>`.

  `child_config` valideynin teqlərini və metadata-sını daxili agentə ötürür. Əvvəl qrafdan kənar işləyən
  çıxarışın izi yoxlamaya bağlı deyildi; bunu real izləri oxuyanda tapdım və düzəltdim.
- **`python scripts/langsmith_check.py [N]`** — son N kök izi **yalnız oxuyur** və quruluşunu yoxlayır:
  ad, teq, metadata, agent teqləri, alət çağırışları, xətalar.
- **`python scripts/langsmith_eval.py`** — `biznes-plan-qebul-ssenarileri` datasetini yaradır (5 ssenari) və
  5 evaluator ilə eksperiment yükləyir: status qaydası, NPV, PP, boş yerlər, rəqəm qoruyucusu. **Saxta
  modellə** işləyir: deterministik hissələri qiymətləndirir, modelin keyfiyyətini yox. `--local`
  açarı ilə LangSmith-ə heç nə göndərmir. İkinci dataset `biznes-plan-aydinliq-qaydalari` (3 ssenari,
  4 evaluator) interfeysin qaydalarını API üzərindən yoxlayır: tələb saylarının hissələri cəmə bərabərdir
  və giriş ekranındakı faktlarla üst-üstə düşür; ayrıca sənəd/natamam bənd olanda nəticə "hamısı"
  sayılmır; eyni adlı plan yeni plan yaradır, versiya yalnız açıq seçimlə əlavə olunur. Bir dataseti
  ayrıca işlətmək üçün adını arqument kimi verin.
- **Faktiki (5 oktyabr 2026):**
  - `langsmith_check.py`: real model ilə aparılmış yoxlamanın izində 49 LLM çağırışı, 96 alət
    çağırışı və bütün agent teqləri var; köhnə çıxarış izi "tanınmayan" kimi işarələndi (düzəlişdən
    əvvəlki iz);
  - `langsmith_eval.py`: eksperiment `saxta-model-3d54963f`, 5 evaluatorun hər biri **5/5**.
  - `langsmith_eval.py biznes-plan-aydinliq-qaydalari`: eksperiment `aydinliq-ec0a1ee8`, 4 evaluatorun
    hər biri **3/3**; evaluator-ların səhvi tutduğu ayrıca yoxlanıldı (birləşmə, yalançı "hamısı", səhv say).

## Agentlər nə etdi (canlı jurnal)

Hər agentin hansı alətləri hansı arqumentlərlə çağırdığı, nə qədər çəkdiyi və harada xəta olduğu
göstərilir. Bu, kursun tool calling və observability mövzusunu ekrana çıxarır. **Göstərilmir:**
modelin daxili düşüncəsi, sərbəst mətni və sənədin məzmunu.

- `app/events.py` — `EventLogger` (LangChain callback handler). LangSmith izləyicisi ilə **yanaşı**
  işləyir və thread-safe-dir, çünki uyğunluq qrupları paralel işləyir. Yazdığı hadisələr:
  - **qovşaqlar** — başlanğıc, müddət, status;
  - **alətlər** — ad, ≤200 simvol arqument, qısa nəticə ("52 bölmə", "T27: 15 sətir"), müddət.
    Nəticə `XƏTA:` ilə başlayırsa, status "alət xətası" olur;
  - **LLM çağırışları** — say və token (`usage_metadata` varsa);
  - **"nəticə hazır"** — `ToolStrategy`-nin struktur cavabı `on_tool_start` çağırmadığı üçün
    qovşaq bu hadisəni özü yazır (yoxlanılıb).
- **Agent və qrup** metadata-dan götürülür: maliyyə üçün `{"agent": "maliyye"}`. Uyğunluq qruplarının
  hər biri `batch`-da ayrıca config alır: `{"agent": "uygunluq", "group": …, "group_title": …}`.
- **Cəhdlər:** hər icra cəhdi nömrələnir (`attempt`). Davam edəndə nömrə 1 artır, köhnə cəhdin
  hadisələri qalır. Təsdiqdən əvvəlki tələb çıxarışı `attempt=0` ilə yazılır.
- **API:** `GET /api/checks/{id}/events?after=<son id>` — artımlı, yalnız yeni hadisələr qaytarılır.
- **İcra ekranı:** addımların yanında canlı lent.
- **"Agentlər" tabı:**
  - xülasə: LLM çağırışları, alət çağırışları, alət xətaları, icra müddəti;
  - cəhdlər, məsələn "1-ci cəhd — dayandı (Uyğunluq eksperti)" və "2-ci cəhd — davam etdi və tamamlandı";
  - hər cəhd üçün ayrıca zaman xətti. Uyğunluq qrupları ayrı alt-sətirlərdədir, paralellik görünür.
    Davamda maliyyə yoxlayıcısının yenidən işləmədiyi qeyd olunur;
  - zolağa klikləyəndə həmin sətrin çağırışları açılır;
  - süzgəcli cədvəl: agent üzrə və "yalnız xətalar".
- Jurnal yazıla bilməsə, yoxlama dayanmır (`raise_error=False`).

## Dəlil paneli — "bu harada yazılıb?"

Maliyyə yoxlamasına, tələbə və ya boş yerə klikləyəndə sağdan dəlil paneli açılır. Panel dialoqdur:
Esc ilə bağlanır, fokus panelin içində qalır, bağlananda əvvəlki sətrə qayıdır. Panel planın
orijinal parçasını vurğu ilə göstərir.

- `app/evidence.py`:
  - `locate_number` — rəqəmi bölmə mətnlərində axtarır (NBSP və mötərizəli mənfi daxil) və
    ±150 simvolluq parça qaytarır;
  - pul axını yoxlamalarında (FCFF, NPV, IRR, PP) istifadə olunan cədvəl sətirləri verilir, xanalar
    **sənəddə yazıldığı kimi** ("(13 481 000)", "–"). FCFF uyğunsuz olanda həmin ilin sütunu işarə
    **və** mətnlə göstərilir;
  - tələblər üçün istinad edilən bölmənin ilk ~800 simvolu və həmin bölmədəki cədvəllərin adları;
  - boş yerlər üçün vurğulanmış parça.
- **Vurğu mövqeyi** xam mətndə hesablanır. Frontend parçanı üç hissəyə bölür və hər hissəni ayrıca
  `textContent` ilə yazır, `innerHTML` istifadə olunmur.
- **Sənədin özü** `doc_json` sütununda saxlanılır və API cavabına daxil edilmir.
  `GET /api/checks/{id}/section?title=…` tam bölmə mətnini verir ("Tam bölməni göstər").
  Köhnə yoxlamalarda sənəd saxlanmayıb, onlar köhnə qaydada göstərilir.
- Rəqəm sənəddə tapılmadıqda belə yazılır: "Bu rəqəm sənəddə tapılmadı — agentin verdiyi dəyər
  istifadə olunmayıb".

## Nəticə tabı: saylar və düzəliş kartları

Yalnız təqdimat qatıdır (`static/report.js` — DOM-suz və LLM-siz, `static/app.js` — göstərmə). Yoxlama
məntiqi, statuslar və maliyyə rəqəmləri burada dəyişmir; model mətni (rəy, suallar) iştirak etmir.

**"Yoxlamanın nəticəsi" bloku** (`Report.buildOverview`):
- **başlıq:** "Düzəliş lazımdır — 9 düzəliş, 1 dəqiqləşdirmə". Saylar aşağıdakı kartların öz sayıdır
  ("Vacib" + "Düzəliş" kartları → düzəliş, "Dəqiqləşdirin" kartları → dəqiqləşdirmə);
- **bloklayan problem cümləsi** statusu müəyyən edən qaydanın öz səbəblərindən gəlir
  (`result.reasons`, ağırlıq `kritik`: kritik maliyyə uyğunsuzluğu və ya tamamilə cavabsız tələb).
  Belə səbəb yoxdursa: "Bloklayan problem yoxdur…";
- **3 kliklənən göstərici** (bir sətirdə, mobildə alt-alta; hər biri öz tabını açır):

  | Göstərici | Nümunə (CFG v2) | Mənbə |
  | --- | --- | --- |
  | Maliyyə | **6/7** uyğun · 1 dəqiqləşdirmə | `Report.financeCounts` — "Maliyyə" tab nişanı ilə eyni qayda |
  | Tələblər | **34/44** tam · 9 natamam · 1 tətbiq edilmir · 3 ayrıca sənəd | `reqCounts` — əhatə siyahısı və "Standart tələblər" nişanı ilə eyni |
  | Boş yerlər | **8** yer · 7-si düzəlişlərin içində · 1-i ayrıca kartda | kartların `holes` sahəsi |

  Əlavə tələblər varsa, dördüncü göstərici çıxır. **44 və 47:** tələb göstəricisinin tooltip-i fərqi
  açıq deyir — "47 standart tələb: 44-i planın mətnində yoxlanılıb… 3 ayrıca sənəddir, mövcudluğu
  yoxlanılmır";
- **"Ən vacib 3 düzəliş"** — siyahının ilk 3 kartına keçid. Kart gizli hissədədirsə siyahı açılır,
  kart görünür və fokus alır;
- "əsasən: X, Y, Z və s." cümləsi yoxdur. AI qeydi bir sətirdir, kiçik və bozdur.
  "Status yenilənmiş qaydalarla yenidən hesablanıb (əvvəl: …)" qeydi "Yoxlama haqqında" bölməsindədir.

**Sayların əlaqəsi** siyahının üstündə bir sətirlə yazılır: "Siyahı belə yığılıb: 9 tələb bəndi → 8 kart
(LT6 və IP6 eyni cədvələ aid olduğu üçün bir kartdadır) · 8 boş yerdən 7-si tələb kartlarının
içindədir, 1-i ayrıca kartdadır · 1 maliyyə bəndi." Bunun üçün hər kart nəyi birləşdirdiyini bilir:
`codes` (tələb kodları və tam adları) və `holes` (boş yerlərin indeksləri).

**Düzəliş kartları** (`Report.buildReport`):
- **kod** (TS2, LT6…) kiçik və bozdur, tələbin tam adı tooltip-də və ekran oxuyucudadır;
- **birləşdirmə:** eyni cədvələ və ya bölməyə aid, mövzu adında ortaq söz kökü olan tələblər bir kartdır
  (məs. LT6 "Avadanlıq və təchizatçılar" + IP6 "Avadanlıq siyahısı", ikisi də Cədvəl 3.5). Ümumi sözlər
  ("layihə", "plan" və s.) birləşdirməyə səbəb olmur;
- **"Nə etmək lazımdır" tapıntıdan qurulur:** "X göstərilməyib / doldurulmayıb / boş qalıb" →
  "Plana əlavə edin: X" ("…var, lakin X…" olduqda yalnız X). Məs. YI1: "Plana əlavə edin: ofis, T&İ,
  laboratoriya və yataqxana binasının sahəsi". Tələbin şablon tövsiyəsi yalnız tapıntıda konkret sahə
  olmayanda işlənir (`Report.actionFor`);
- **"Nə çatışmır" çatışmazlıq kimi yazılır:** tapşırıq formalı mətn ("Niyyət məktublarının CFG adına
  yenilənməsi.") → "Niyyət məktubları CFG adına yenilənməyib." (`Report.asShortfall`);
- **heç bir tələbə aid olmayan boş yer** konkret başlıqla göstərilir ("Yataqxananın yer sayı və istismar
  xərcləri", tövsiyə: "Plana əlavə edin: …"). Belə yer bir neçədirsə, hamısı bir "Digər boş yerlər"
  kartında, hər biri bölməsi və "yerinə bax" keçidi ilə;
- default olaraq **ilk 6 kart** görünür, altda "Daha N bənd göstər" (açıq halda "Daha az göstər").
  Çapda bütün kartlar açılır, çapdan sonra siyahı yenə yığılır.

## İqtisadi təhlil

Uyğunluq yoxlamasından **ayrı** nəticədir (`app/economics/`, ayrıca `economics` cədvəli): hazırlıq
statusuna, addımlara və checkpoint-lərə toxunmur. Prinsip eynidir — **AI rəqəm vermir**:

- model yalnız YER göstərir: cədvəldəki rəqəm üçün cədvəl id-si, sətrin adı və sütunun başlığı (rəqəmi
  **Python xanadan özü oxuyur**, modelin rəqəmi istifadə olunmur); mətndəki rəqəm üçün hərfi sitat
  (`verify_citation` ilə tutuşdurulur); illər üzrə sətir üçün cədvəl və sətir (`read_row`);
- təsdiqlənməyən yer istifadə olunmur — "Təsdiqlənməyən yerlər" siyahısına düşür;
- hər tapıntı deterministik qaydadır: `{id, ad, düstur, rəqəmlər (sitat + yer və ya kodun düsturu),
  nəticə, ciddilik, sual, tələb olunan sənədlər}`.

**Axın.** Yoxlama `tamamlandi` olandan sonra avtomatik başlayır (`ECONOMICS_AUTO`), xətası yoxlamaya
təsir etmir. Köhnə yoxlamalar üçün tabdakı düymə (`POST /api/checks/{id}/economics`). Yerlər yaddaşda
(`memo`) saxlanılır: "Yenidən hesabla" modeli çağırmır; "Yenidən oxu (model ilə)" (`?fresh=1`) yaddaşı
silir və model sənədi yenidən oxuyur. Agentə sənədin bütün cədvəlləri və bölmələrin siyahısı tapşırıqda
`<sened>` zərfində verilir (məlumatdır, təlimat deyil) — model alətlə yalnız lazım olan mətn bölmələrini
oxuyur; əvvəlki variant (hər cədvəli alətlə oxumaq) real modeldə addım limitini aşırdı.

**1a. Daxili məntiqi uyğunluq** (`app/economics/rules.py`):

| Qayda | Nə yoxlanılır |
| --- | --- |
| `gelir_hecm_qiymet` | satış gəliri_t ≈ satış həcmi_t × orta qiymət (≤ 1% uyğun, ≤ 5% aşağı, > 5% orta) |
| `hecm_guc` | max(satış həcmi) ≤ praktiki güc (aşılarsa — yüksək) |
| `guc_rampasi` | 1-ci il gücdən istifadə < 90% |
| `xammal_xerci` | xammal xərci_t ≈ 1 tona xammal × həcm_t |
| `enerji_xerci` | elektrik və qaz: sərfiyyat × tarif = xərc |
| `emek_haqqi_fondu` | illik fond = aylıq fond × 12; orta maaş = aylıq fond / ştat (reallıq üçün) |
| `amortizasiya` | 1-ci il ≈ binalar × norma + avadanlıq × norma |
| `capex_investisiya` | binalar + avadanlıq + dövriyyə kapitalı = ümumi investisiya |
| `maliyyelesme_menbeleri` | maliyyə yoxlamasının öz nəticəsi (`menbeler_cemi`) — təkrar hesablanmır |
| `vergi_guzestleri` | güzəşt iddia olunubsa — rezidentlik / investisiya təşviqi sənədi tələb olunur |
| `dovriyye_kapitali` | debitor, kreditor, ehtiyat günləri var və 0 deyil |
| `diskont_esaslandirma` | dərəcə AMB uçot dərəcəsi / risksiz dərəcə + risk mükafatı ilə əsaslandırılıb |
| `irr_diskont_ferqi` | IRR − diskont ≥ 2 faiz bəndi (mənfi — yüksək) |
| `qaliq_deyer_payi` | PV(qalıq dəyər) / PV(müsbət axınlar) ≤ 60% və qalıq dəyərsiz NPV ≥ 0 |
| `proqnoz_ufuqu` | məlumat: pul axınının illəri |
| `dscr` | kredit varsa: (EBITDA − vergi) / (əsas borc + faiz) ≥ 1,2; "kredit cəlb edilmir" — tətbiq edilmir |
| `zaman_xetti` | icra qrafikinin bitmə ili ≤ satışın birinci ili |
| `xammal_payi_bazasi` | xammalın payı dəyişən və tam maya dəyərində — fərqli bazalar ziddiyyət deyil, aydınlıq sualıdır |

**Həssaslıq** (`app/economics/sensitivity.py`, kodun hesabı): qiymət −10%, xammal +10%, capex +15%,
satışın 1 il gecikməsi, gücdən istifadə 80% → NPV, ΔNPV, IRR; zərərsizlik həcmi (gücün %-i, həcmin
zərərsizlikdən aşağı olduğu illər); tornado qrafiki. **Sadələşdirmə açıq yazılır:** dəyişiklik FCFF-ə
vergi effekti olmadan əlavə olunur, qalıq dəyər və amortizasiya dəyişmir. Ümumi "Həssaslıq" tapıntısı
risk səviyyəsi üçündür və sual vermir; **NPV < 0 olan hər ssenari ayrıca tapıntıdır** (`hessasliq:<ssenari>`)
— öz sualı (rəqəmlərlə: ssenari NPV və baza NPV) və öz sənədi ilə.

**Risk səviyyəsi** (qayda): *yüksək* — "yüksək" ciddilikli bayraq, ≥ 2 ssenaridə NPV < 0 və ya baza NPV
< 0; *orta* — "orta" bayraq və ya 1 ssenaridə NPV < 0; əks halda *aşağı*.

**1b. Reallıq** (`config/benchmarks/gubre.yaml`, `app/economics/benchmarks.py`): hər göstərici üçün
min/max, vahid, valyuta, **mənbə və tarix**. Mənbəsi (`TODO` olmayan) və ya tarixi olmayan sətir
istifadə olunmur — "yoxlanıla bilməz", təxmin yoxdur. USD/EUR hədləri AMB-nin rəsmi məzənnəsi ilə manata
çevrilir (məzənnə alınmasa — "yoxlanıla bilməz"). **Faylda rəqəm uydurulmayıb:** dəyər və mənbə
sahələrini komitə doldurur (yalnız tapşırıqda verilən vergi dərəcələri yazılıb, onların da mənbəsi `TODO`).

**1c. Suallar** (`app/economics/questions.py`): hər tapıntının sualı rəqəmlərlə şablondan qurulur.
Statuslar: açıq → cavab gözlənilir → cavablandı → qəbul edildi / rədd edildi (qərar verən və qeyd ilə).
Komitə üzvü sual əlavə edir, redaktə edir, komitənin sualını silir; təhlil yenidən hesablananda redaktə
edilmiş mətn və status **qorunur**. Qayda artıq sual vermirsə: komitə toxunmayıbsa (açıq, redaktəsiz,
sənəd bağlanmayıb) sual silinir, toxunubsa "qayda artıq bayraq vermir" kimi qalır. "Suallar məktubu" —
`.docx` (rəsmi məktub: tarix, kimə, mövzu, nömrələnmiş suallar, sənəd siyahısı, imza yeri; sənəd
tələb etməyən sualın yanında "(yazılı cavab)"); PDF — çap görünüşü ilə.

**Sual ↔ tələb olunan sənəd** — `config/doc_requirements.yaml` (kodda hardcode yoxdur; sənəd adları da
buradadır). Qayda: hər sual yalnız riski **birbaşa azaldan** və ya rəqəmi **təsdiqləyən** sənədi tələb
edir; boş siyahı — sənəd tələb olunmur, UI-da "**Yazılı cavab — sənəd tələb olunmur**" göstərilir və
"Sənəd yüklə" düyməsi çıxmır. Sənəd yalnız sualı olan tapıntıya bağlanır (`rules.required_documents`).

| Sual | Tələb olunan sənəd |
| --- | --- |
| Həssaslıq — qiymət −10% | uzunmüddətli satış müqaviləsi / qiymət formulu olan müqavilə; qiymət riskinin idarə planı |
| Həssaslıq — xammal +10% | uzunmüddətli xammal təchizatı müqaviləsi / sabit qiymətli təklif; hedcinq planı |
| Həssaslıq — capex +15% | avadanlıq üzrə kommersiya təklifi; gözlənilməz xərclər ehtiyatının əsaslandırılması |
| Həssaslıq — güc istifadəsi 80% | niyyət məktubları; satış həcmini təsdiqləyən müqavilələr |
| Həssaslıq — 1 il gecikmə | yazılı cavab |
| Maliyyələşmə mənbələri | öz vəsait üzrə bank arayışı; fondun maliyyələşmə təsdiqi |
| Vergi güzəşti | sənaye parkı rezidentlik şəhadətnaməsi / investisiya təşviqi sənədi |
| Zərərsizlik nöqtəsi | satış həcmini təsdiqləyən müqavilələr |
| Diskont dərəcəsi, IRR − diskont, qalıq dəyər, dövriyyə günləri, xammal payının bazası | yazılı cavab |
| Gəlir, əmək haqqı, amortizasiya fərqi | Excel maliyyə modeli |
| Enerji / tariflər | tarif və qoşulma şərtləri məktubu |
| Güc, capex, zaman xətti | kommersiya təklifi (zaman xətti — həm də torpaq çıxarışı) |
| DSCR | bankın kredit təklif məktubu |

**1d. Əlavə sənədlər** (`app/economics/evidence.py`; XLSX, PDF, DOCX, JPG, PNG, ≤ 15 MB): suala,
ayrıca sənəd tələbinə (məs. LT3) və ya ümumi plana bağlanır, yoxlamanın versiyasına aiddir.
- **Excel** — tamamilə deterministik (openpyxl): NPV, IRR (0,118 → 11,8%), PP, ümumi investisiya,
  1-ci il gəliri tapılır və planın təsdiqlənmiş rəqəmləri ilə tutuşdurulur; sabit (hardcode) xanaların
  payı; `#REF!`, `#DIV/0!` və s. xəta xanaları; düsturun dəyəri faylda saxlanmayıbsa — açıq yazılır.
- **PDF/DOCX** — model faktı HƏRFİ sitatla çıxarır (tərəf, ünvanlanan şirkət, tarix, məbləğ, valyuta,
  həcm, etibarlılıq); sitat sənəd mətnində yoxlanılır, rəqəm sitatdan götürülür. Kod tutuşdurur: ünvan ↔
  şirkətin adı, məbləğ (AMB məzənnəsi ilə) ↔ capex cədvəlinin **ən yaxın sətri**, həcm ↔ satış planı,
  etibarlılıq tarixi; imza/möhür yalnız qeyd olunur.
- **Şəkil** — yalnız mövcudluq (məzmun qiymətləndirilmir).

Sənəd yükləndikdən (və ya silindikdən) sonra qaydalar **modelsiz** yenidən hesablanır; dəyişənlər
(tapıntının statusu, risk səviyyəsi) "əvvəl/sonra" kimi **Müqayisə** tabında göstərilir. Nəticə tabındakı
"Ayrıca təqdim ediləcək sənədlər" blokunda yüklənmiş sənəd üçün ✓ və yoxlamanın nəticəsi, yoxdursa
"Gözlənilir" yazılır.

**CFG v2 üzərində** (6 oktyabr 2026): risk *yüksək* (5 ssenaridən 4-də NPV < 0); 12 açıq sual, o
cümlədən maliyyələşmə mənbələri (16 760 899 ↔ 14 746 938, fərq 2 013 961; bank arayışı, fondun
təsdiqi), həssaslıq üzrə 4 ayrıca sual (qiymət, xammal, capex, güc istifadəsi — hər biri öz sənədi
ilə; niyyət məktubu və kommersiya təklifi yalnız aid olduğu ssenaridə), qalıq dəyərsiz NPV −3 354 836
(planın Cədvəl 8.7-si ilə eyni; yazılı cavab), diskont dərəcəsinin əsaslandırılması və IRR − diskont =
1,8 faiz bəndi (yazılı cavab), vergi güzəşti sənədi, zərərsizlik, test Excel modelinin fərqləri və
xammal payının bazası (85,5% dəyişən / 78% tam — hər ikisi düzdür, aydınlıq sualı, yazılı cavab). Gəlir, xammal, enerji, əmək haqqı, amortizasiya və capex qaydaları planın öz rəqəmləri ilə
keçir. Reallıq: 12 göstəricinin hamısı "yoxlanıla bilməz" (benchmark mənbələri doldurulmayıb). Bu
yoxlamada yerləri model yox, **əl ilə** verilib — bax "Real məhdudiyyətlər".

## Tələblər xəritəsi

"Standart tələblər" tabının yuxarısında (açılıb-bağlanan blokda) hər tələb qrupu bir kart kimi göstərilir. Kartda hər tələb statusuna görə
rəngli kiçik kvadratdır: var, natamam, yoxdur, ayrıca sənəd, yoxlanılmadı.

- **Yalnız rəngə güvənilmir:**
  - kartın altında say yazılır, məsələn "7/7 var · 2 sənəd";
  - ayrıca sənəd bəndləri plan mətnində yoxlanılmadığı üçün məxrəcə qatılmır;
  - hər kvadratın `title`/`aria-label`-ı var ("TP3 — natamam"), kartın `aria-label`-ı isə qrupu
    tam təsvir edir.
- **Qrupa klik** "Standart tələblər" tabını açır, süzgəcləri sıfırlayır, həmin qrupa sürüşür və fokusu
  qrup başlığına keçirir. Əlavə tələblər qrupu "Əlavə tələblər" tabına aparır.
- **Maliyyə zolağı:** eyni üslubda 7 maliyyə yoxlaması; kritik yoxlamalar çərçivəlidir.
- **Əfsanə** var. Mobil ekranda kartlar iki sütuna keçir, üfüqi sürüşmə yaranmır.

## Çap / PDF

Nəticə başlığında **"Hesabatı çap et"** düyməsi var; `Ctrl+P` da eyni nəticəni verir.

- **Çapdan əvvəl** süzgəclər sıfırlanır, bütün düzəliş kartları açılır, dəlil paneli bağlanır. Heç bir
  sətir itmir. Çapdan sonra ekranda yenə ilk 6 kart göstərilir.
- **Çapda gizlənir:** sol panel, tablar, düymələr, test rejimi, canlı lent, qrafiklər və agent diaqramları.
- **Bütün bölmələr ardıcıl çap olunur:** başlıq və status → nəticə bloku və düzəliş kartları → rəy → tələblər xəritəsi → əsas göstəricilər
  → müqayisə → maliyyə cədvəli → standart tələblər → əlavə tələblər → boş yerlər → agent
  fəaliyyətinin qısa xülasəsi. Müqayisə, əlavə tələblər və agent bölməsi yalnız məlumat olduqda
  çap olunur.
- **Səhifə:** A4, 16 mm kənar boşluğu.
  - Cədvəl sətirləri və tələb kartları səhifələr arasında bölünmür, cədvəl başlığı hər səhifədə
    təkrarlanır.
  - Status rəngləri saxlanılır.
  - Hər səhifənin altında qeyd ("Avtomatik ilkin yoxlama. İnvestisiya qərarı deyil. Rəqəmlər planın öz
    cədvəllərindən yenidən hesablanıb.") və səhifə nömrəsi var.
- **Nümunə:** `docs/hesabat-numune-v1.pdf`, Demo zavod v1, 9 səhifə.
  - Boş səhifə yoxdur, alt qeyd hər səhifədədir.
  - Azərbaycan hərfləri (ə, ı, ş, ç, ğ, ö, ü, İ…) mətn kimi çıxarılır.
  - Yenidən yaratmaq üçün:

  ```
  python tests/ui/print_pdf.py "http://127.0.0.1:8010/?demo=1&check=<id>" hesabat.pdf
  ```

## Arxitektura

```
 Brauzer (static/)                       FastAPI (app/main.py)
 ─────────────────                       ─────────────────────
 index.html · styles.css                 POST /api/checks ──► əlavə varmı?
 app.js  (görünüşlər, tablar)              │ yox                │ hə
 poll.js (nəsilli polling)                 ▼                    ▼
 upload.js (fayl seçimi)              service.run_check   service.extract_requirements
 charts.js (SVG qrafiklər)                 │                agents/extra_requirements.py
 report.js (nəticə bloku, kartlar)         │                    │
 econ-core.js (iqtisadi: DOM-suz məntiq)   │                    │
 economics.js (iqtisadi təhlil, suallar)   │                    │
        ▲   GET /api/checks/{id}           │                    │  (qaralama → təsdiq gözləyir)
        └──────────────────────────────────┤   POST …/requirements (təsdiq) ─┘
                                           ▼
                    LangGraph ana qrafı (app/graph.py) + SqliteSaver checkpoint
   ingest ─► load_previous ─► supervisor ─┬─► finance  (subgraph: locate[LLM] ─► verify ─► compute)
                                          ├─► compliance (subgraph: prepare ─► check_groups[LLM, batch] ─► validate)
                                          ├─► decide_status   (app/verdict.py — qayda)
                                          ├─► compare_previous (app/compare.py — LLM-siz)
                                          ├─► write_summary   (agents/summary.py — faktlar + qoruyucu)
                                          └─► save ──► economics.service.run_safe (qrafdan kənar)
                                                         locate[LLM: yer] ─► verify[Python] ─► rules ─► suallar
   SQLite: checks (vəziyyət, nəticə) · extras (əlavə sənədlər, təsdiqlənmiş siyahı)
           memo (uğurlu model çağırışları) · checkpoints.db (LangGraph)
           economics (faktlar, nəticə, əvvəl/sonra) · questions · evidence (+ uploads/evidence/)
```

- **Retry:** checkpoint-dən davam — tamamlanmış qovşaqlar təkrarlanmır. Uğurlu model nəticələri
  (`memo`) qovşaq ortada yıxılsa və ya server yenidən başlasa da saxlanılır.
- **Uğursuz qrupların təkrarı:** `POST /api/checks/{id}/retry-groups` — yalnız texniki xəta ilə yıxılan
  uyğunluq qrupları yenidən soruşulur; uğurlu qruplar və maliyyə toxunulmur.
- **İqtisadi təhlil qrafdan kənardadır:** köhnə yoxlamalar yenidən işə salınmadan təhlil edilir, sənəd
  yüklənəndə modelsiz yenidən hesablanır; uyğunluq statusu, addımlar və checkpoint-lər dəyişmir.
- **Statik fayllar** `Cache-Control: no-cache` ilə verilir (ETag ilə yoxlanılır, dəyişməyibsə 304):
  əks halda brauzer yeni `index.html` ilə köhnə `app.js`-i işlədə və silinmiş elementə görə səhifə
  çökə bilərdi. `renderResults`-da hər blok ayrıca işləyir — birinin xətası qalanlarını gizlətmir.

### API

| Metod | Yol | Nə edir |
| --- | --- | --- |
| GET | `/api/meta` | limitlər, addımlar, status adları, inkişaf rejimi |
| POST | `/api/checks` | `file`, `plan_id`, `extra_files[]`, `extra_text`, `fail_at` (yalnız DEV_MODE) |
| GET | `/api/checks/{id}` | vəziyyət və nəticə |
| GET | `/api/checks/{id}/events?after=` | agent jurnalı (artımlı) |
| GET | `/api/checks/{id}/section?title=` | bölmənin tam mətni (dəlil paneli) |
| GET | `/api/market` | bazar icmalı (keşlə; mənbə xətası 200 ilə "mövcud deyil" qaytarır) |
| GET | `/api/chat/status` | AI köməkçi qoşulubmu (açar qaytarılmır) |
| POST | `/api/chat` | `{message, history?, check_id?}` → `{reply, context}` |
| GET | `/api/checks/{id}/requirements` | əlavələr, qaralama (rədd edilənlərlə), təsdiqlənmiş siyahı |
| POST | `/api/checks/{id}/requirements` | `{"items": [{id?, text, kind}]}` — təsdiq və yoxlamanın başlanması |
| POST | `/api/checks/{id}/requirements/extract` | tələbləri yenidən çıxar (təsdiqdən əvvəl) |
| POST | `/api/checks/{id}/retry` | xəta ilə dayanmış yoxlamanı davam etdir |
| POST | `/api/checks/{id}/retry-groups` | uğursuz uyğunluq qruplarını yenidən yoxla |
| GET | `/api/plans`, `/api/plans/{plan}/checks` | planlar və versiyalar |
| GET | `/api/checks/{id}/economics` | iqtisadi təhlil: vəziyyət, nəticə, suallar, sənədlər, "əvvəl/sonra" |
| POST | `/api/checks/{id}/economics?fresh=` | təhlili başlat / yenidən hesabla; `fresh=1` — model sənədi yenidən oxuyur. Tamamlanmamış yoxlama üçün 409 |
| POST | `/api/checks/{id}/questions` | `{text, documents[]}` — komitənin sualı |
| PATCH | `/api/questions/{qid}` | `text`, `status`, `documents`, `note`, `decided_by` |
| DELETE | `/api/questions/{qid}` | sualı silir |
| GET | `/api/checks/{id}/questions/letter.docx` | suallar məktubu |
| POST | `/api/checks/{id}/evidence` | `file`, `question_id?`, `req_code?`, `doc_type?` — sənəd (analiz fonda) |
| DELETE | `/api/evidence/{eid}` | sənədi silir, təhlil yenidən hesablanır |
| DELETE | `/api/plans/{plan}` | planı BÜTÜN versiyaları ilə silir (yoxlamalar, hadisələr, LangGraph checkpoint-ləri, yüklənmiş fayllar, planın yaddaşı; başqa planda da olan sənədin yaddaşı saxlanılır). Yoxlama gedirsə 409. İnterfeysdə "Planı sil" təsdiq pəncərəsi ilə. İqtisadi təhlil, suallar və yüklənmiş sənədlər də silinir |

## Mövzu → fayl

| Mövzu | Harada |
| --- | --- |
| LangGraph `StateGraph`, şərti keçid, supervisor marşrutu | `app/graph.py` (`_route`) |
| Subgraph-lar (fərqli state sxemi) | `app/agents/finance.py`, `app/agents/compliance.py` |
| Alətlərlə agent (`create_agent`), hissə-hissə oxuma | `app/agents/doc_tools.py` |
| Strukturlaşdırılmış çıxış (`ToolStrategy`, Pydantic) | `app/schemas.py`, bütün agentlər |
| Paralel çağırış (`batch`, `max_concurrency`) | `app/agents/compliance.py` |
| Checkpointing və davam etdirmə (`SqliteSaver`, `update_state`) | `app/service.py` |
| Uzunmüddətli yaddaş (əvvəlki versiya, müqayisə, sabitləşdirmə) | `app/storage.py`, `app/compare.py` |
| İnsan dövrədə (human-in-the-loop): tələblərin təsdiqi | `app/agents/extra_requirements.py`, `app/service.py`, `static/app.js` |
| Qoruyucular: mənbə yoxlaması, rəqəm qoruyucusu, deterministik status | `app/finance_tools.py`, `app/agents/summary.py`, `app/verdict.py` |
| Prompt injection-a qarşı: sənəd mətni məlumat zərfində | `app/agents/extra_requirements.py`, `app/agents/compliance.py` |
| Xəta idarəetməsi: ehtiyat rəy, texniki xətanın ayrılması, qrup retry | `app/agents/summary.py`, `app/agents/compliance.py`, `app/main.py` |
| İzləmə (LangSmith: izin adı, teqlər, metadata) | `app/service.py` (`_run_config`) |
| Sənədin oxunması (DOCX, PDF, TXT) | `app/ingest.py`, `app/attachments.py` |
| İqtisadi təhlil: yerləşdirmə + yoxlama, qaydalar, həssaslıq, benchmark, suallar, sənədlər | `app/economics/` (`extract.py`, `rules.py`, `sensitivity.py`, `benchmarks.py`, `questions.py`, `evidence.py`, `service.py`), `config/benchmarks/gubre.yaml`, `config/doc_requirements.yaml` (sual ↔ sənəd), `static/econ-core.js` (göstərmə məntiqi, Node testləri), `static/economics.js` (DOM) |
| Tab zolağı ("Daha çox" menyusu), yapışqan ofsetlər (`--tabs-h`, `--filters-h`) | `static/app.js` (`layoutTabs`, `renderTabsMenu`, `updateStickyOffsets`), `static/styles.css` |
| Nəticə bloku, düzəliş kartları (saylar, birləşdirmə, tövsiyənin tapıntıdan qurulması) | `static/report.js` (`buildOverview`, `buildReport`), `static/app.js` (`renderOverview`, `fixItem`) |

## 5 dəqiqəlik demo ssenarisi

Real model lazım deyil. Canlı hissələr saxta modelli serverdə (`python scripts/fake_server.py` →
http://127.0.0.1:8011, inkişaf rejimi açıqdır) göstərilir. Hazır nəticələr isə `/?demo=1`-də
(8010) göstərilir, demo heç nəyi tarixçəyə yazmır.

| Vaxt | Addım | Nə göstərilir |
| --- | --- | --- |
| 0:00 | **:8011** → plan adı yaz, `samples/plan_demo_v1.docx` yüklə → "Yoxlamanı başlat" | Yükləmə forması, limitlər |
| 0:20 | **Canlı agent lenti** | Hansı agentin işlədiyi, alət çağırışları ("S12 bölməsini oxudu"), qrup nəticələri. Faiz və ya model düşüncəsi göstərilmir. |
| 1:00 | **Nəticə tabı**, sonra **tələblər xəritəsi** (Standart tələblər) | *Düzəliş lazımdır — N düzəliş, M dəqiqləşdirmə*; bloklayan problem cümləsi; Maliyyə / Tələblər / Boş yerlər göstəriciləri (klik → tab); "Ən vacib 3 düzəliş" keçidləri. Xəritədə 11 qrup kvadratla, "7/7 var · 2 sənəd"; "6. Təşkilati plan" kartı → həmin qrupun tələbləri. |
| 1:45 | **Maliyyə → "Özünü ödəmə müddəti (PP)" ⚠️** sətrinə klik → **dəlil paneli** | 6,9 il (planda) və 6,96 il (Python); T27-nin FCFF sətri sənəddə yazıldığı kimi; mətndə **6,9** vurğulanıb; "Tam bölməni göstər". |
| 2:15 | **İqtisadi təhlil** tabı → **Suallar və sənədlər** | Risk səviyyəsi, 3 göstərici, tapıntılar (hər rəqəmin mənbəyi), həssaslıq cədvəli və tornado; sual statusunu dəyiş, Excel modeli yüklə → plan ↔ model fərqləri, Müqayisə tabında "əvvəl/sonra". |
| 2:30 | **Agentlər** tabı | Hər agentin vaxt zolağı, LLM/alət çağırışlarının sayı, xətalar, cəhdlər. |
| 3:00 | **Süni xəta və davam:** yeni yoxlamada "İnkişaf rejimi: süni xəta" → *Uyğunluq agentində süni xəta* → başlat → "Yoxlama dayandı" → **"Yoxlamanı davam etdir"** | Tamamlanmış mərhələlər təkrarlanmır. Agentlər tabında **2 cəhd** görünür: birinci xəta ilə, ikinci uğurla. |
| 4:15 | **"Hesabatı çap et"** → PDF kimi saxla | A4, bütün bölmələr bir sənəddə, cədvəl başlığı hər səhifədə, altda qeyd: "Avtomatik ilkin yoxlama. İnvestisiya qərarı deyil." Nümunə: `docs/hesabat-numune-v1.pdf`. |

Vaxt qalsa: **Demo zavod v2 → Müqayisə** (3 boş yer doldurulub, PP *Xəbərdarlıq → Uyğun*) və
**Demo əlavə tələblər** (tələb sənədindəki fraqment ↔ plandakı cavab, sığorta bəndi *Yoxdur* → *Hazır deyil*).

## Testlər

```bash
pytest -q                     # Python + JS (Node varsa) — real API çağırılmır
node --test tests/js/poll.test.js tests/js/upload.test.js tests/js/charts.test.js tests/js/agents.test.js tests/js/chat.test.js tests/js/report.test.js tests/js/econ.test.js
```

- **İzolyasiya:**
  - testlər **müvəqqəti DATA_DIR** ilə işləyir, real açarlar `.env`-dən yüklənmir;
  - **xarici şəbəkə bloklanıb** (yalnız loopback açıqdır), LangSmith söndürülüb;
  - model saxtadır (`tests/fake_llm.py`), yeni testlər sintetik sənədlərlə qurulur (`tests/synthetic.py`);
  - `samples/` faylları yalnız oxunur;
  - iqtisadi təhlil: saxta model demo faylı üçün yerləri (`DEMO_ECONOMICS`) və əlavə sənəddəki
    "Tərəf: …", "Məbləğ: …" sətirlərindən faktları qaytarır; məzənnə testdə `set_fx_override` ilə verilir.
- **Node qeydi:** `node --test tests/js/` (qovluq adı ilə) Node 24-də işləmir, fayllar açıq sadalanmalıdır.
  `pytest` bunu özü edir (`tests/test_frontend_js.py`, bütün `*.test.js` faylları bir test kimi).
- **Brauzer testləri** `pytest`-ə daxil deyil. Chrome və işləyən server lazımdır:
  ```bash
  python scripts/fake_server.py            # ayrı terminalda, 127.0.0.1:8011, saxta model
  python tests/ui/e2e_ui.py                # yükləmə → təsdiq → nəticə → v2 → keçid → retry
  python tests/ui/limits_ui.py             # 103 tələb: limit xəbərdarlığı və razılıqla təsdiq
  python tests/ui/clarity_ui.py [qovluq]   # nəticə bloku: göstəricilər = əhatə, başlıq sayları = kartlar
  python tests/ui/delete_ui.py [qovluq]    # "Planı sil" axını (yalnız saxta serverdə!)
  python tests/ui/a11y.py "http://127.0.0.1:8010/?demo=1&check=<id>&tab=xulase"
  python tests/ui/a11y.py "<demo url>" --econ "http://127.0.0.1:8010/?check=<id>&tab=iqtisadi"
                                           # + İqtisadi təhlil və Suallar tabları (real yoxlama; heç nə dəyişdirmir)
  python tests/ui/print_pdf.py "http://127.0.0.1:8010/?demo=1&check=<id>" hesabat.pdf
  python tests/ui/redesign_ui.py [qovluq]  # mərhələlər, akkordeon, AI köməkçi, bazar, 3 en, reduced motion
  python tests/ui/shoot.py <qovluq> upload="http://127.0.0.1:8010/?demo=1"   # 1440/768/390
  ```
  `fake_server.py` çıxışı özü UTF-8-ə keçirir — Windows konsolunda (cp1252) `PYTHONUTF8` olmadan da
  işləyir.

### Qəbul ssenariləri

| Ssenari | Test |
| --- | --- |
| Əlavəsiz biznes plan yükləmə və nəticə | `test_scenarios.py::test_v1`, `test_api.py::test_docx_yüklənir_və_oxunur`, `test_extras.py::test_əlavəsiz_axın_dəyişmir` |
| Əlavə sənəd çıxarışı, redaktə, təsdiq və tam yoxlama | `test_scenarios.py::test_əlavə_tələb_tam_axın`, `test_extras.py::test_redaktə_silmə_əlavə_və_təsdiq`, `e2e_ui.py` |
| Naməlum stil olan DOCX | `test_extras.py::test_naməlum_stilli_docx_xətasız_oxunur` |
| Eyni fraqmentdən iki ayrı tələb | `test_extras.py::test_eyni_fraqmentdən_iki_fərqli_tələb_saxlanılır` |
| Limitdən çox tələb və aydın xəbərdarlıq | `test_extras.py::test_bənd_sayı_limiti_açıq_bildirilir`, `…::test_natamam_siyahı_razılıqsız_təsdiqlənmir`, `limits_ui.py` |
| Mənfi NPV-nin rəydə müsbət göstərilməsinin rəddi | `test_scenarios.py::test_mənfi_npv_rəydə_müsbət_rədd_edilir`, `…::test_npv_işarəsi_rəydə_dəyişdirilə_bilməz`, `test_verdict.py` (işarə testləri) |
| Fayl ölçüsü və ümumi yükləmə limiti | `test_upload_limits.py` (dəqiq hədd, +1 bayt, cəm, say, oxumanın dayanması, iz qalmaması, 413) |
| v1-dən v2-yə boş yerlər və PP dəyişməsi | `test_scenarios.py::test_v2_müqayisə`, `test_compare.py::test_boş_yerlər_doldurulan_və_yeni` |
| Uğursuz qrupun retry edilməsi | `test_retry.py::test_yalnız_uğursuz_qrup_təkrarlanır`, `…::test_api_uğursuz_qrup_təkrarı` |
| Server restartından sonra davam | `test_scenarios.py::test_restartdan_sonra_davam`, `test_retry.py::test_restartdan_sonra_*` |
| Köhnə nəticələrin açılması | `test_scenarios.py::test_köhnə_nəticə_açılır`, `test_extras.py::test_köhnə_saxlanmış_nəticə_açılır` |
| İqtisadi təhlil: hər qayda üçün keçən və bayraqlanan nümunə | `test_economics.py` (`test_gəlir_həcm_qiymət` … `test_zərərsizlik_nöqtəsi`) |
| AI-dan sitatsız rəqəm qəbul edilmir; cədvəl rəqəmini Python oxuyur | `test_economics.py::test_sitatsız_və_ya_uyğunsuz_rəqəm_rədd_edilir`, `…::test_cədvəl_xanasının_rəqəmini_python_oxuyur_modelin_rəqəmi_yox` |
| Mənbəsiz/tarixsiz benchmark istifadə edilmir; USD → AZN | `test_economics.py::test_mənbəsiz_benchmark_istifadə_edilmir`, `…::test_benchmark_diapazonu_və_usd_çevrilməsi`, `…::test_layihədəki_benchmark_faylında_uydurma_rəqəm_və_mənbə_yoxdur` |
| Maliyyələşmə mənbələri fərqi və 78%/85,5% sual kimi | `test_economics.py::test_maliyyələşmə_mənbələri_fərqi_sual_olur`, `…::test_xammal_payı_78_85_ziddiyyət_deyil_aydınlıq_sualıdır` |
| Excel yüklənəndə plan ↔ model fərqləri, "əvvəl/sonra" | `test_economics.py::test_excel_yüklənəndə_plan_model_fərqləri_və_əvvəl_sonra` |
| Sual ↔ sənəd: hər qayda tipi və hər həssaslıq ssenarisi üçün gözlənilən sənədlər; xəritə tamdır | `test_economics.py::test_qayda_tipi_üçün_gözlənilən_sənədlər`, `…::test_həssaslıq_ssenarisi_üçün_gözlənilən_sənədlər`, `…::test_xəritə_tamdır_və_yalnız_tanınan_sənədlər_istifadə_olunur`, `…::test_hər_npv_mənfi_ssenarisi_ayrıca_sual_və_öz_sənədi` |
| İqtisadi təhlilin göstərmə məntiqi (sıra, süzgəc, mənbə mətni, göstəricilər, yazılı cavab) | `tests/js/econ.test.js` |
| Suallar: redaktə, status, silmə, məktub; komitənin dəyişikliyi qorunur | `test_economics.py::test_suallar_api_redaktə_status_silmə_və_məktub` |
| Sorğu davam edərkən başqa yoxlamaya keçid | `tests/js/poll.test.js` ("A sorğusu davam edərkən B açılır…"), `e2e_ui.py` |

### Son faktiki nəticə (6 oktyabr 2026, tab zolağı, yapışqan ofsetlər və sual ↔ sənəd xəritəsi ilə)

| Dəst | Keçdi | Uğursuz | Ötürülən |
| --- | --- | --- | --- |
| `pytest -q` (Python; JS bir test kimi daxildir; 58-i `test_economics.py`) | **395** | 0 | 0 |
| Node, `node --test` (7 fayl, `econ.test.js` daxil) | **53** | 0 | 0 |
| Brauzer: `e2e_ui.py` | **18** | 0 | — |
| Brauzer: `limits_ui.py` | **7** | 0 | — |
| Brauzer: `a11y.py --econ` (Demo zavod v1 + CFG v2: tablar, zolaqda scroll yoxdur, "Daha çox" menyusu, detal paneli, mobil menyu, "Mənbəyə bax"; İqtisadi təhlil və Suallar tablarında klaviatura, adlar, mətnlə status, cədvəl semantikası, 390 px) | **47** | 0 | — |
| Brauzer: `redesign_ui.py` (1440/768/390, chat, reduced motion, panel, tablar, yığılmış bazar) | **31** | 0 | — |
| Brauzer: `clarity_ui.py` (nəticə bloku sayları, kartlar, "Ətraflı", plan seçimi) | **17** | 0 | — |
| Brauzer: `delete_ui.py` | **10** | 0 | — |

- `redesign_ui.py` bir icrada 28/30 verdi: bazar tabları testi yığılmış vidcetə uyğunlaşdırılmamışdı
  (düzəldildi — test əvvəl vidceti açır), mərhələ göstəricisi isə bir dəfə zamanlama səbəbindən
  uğursuz oldu. Sonrakı iki icrada 31/31 keçdi.
- Nəticə tabı əlavə olaraq real CFG v2 yoxlamasında 974 və 375 px-də skrinşotla yoxlanılıb: overlay
  mətnin üstünə düşmür, sidebar-da kəsilmə və üfüqi daşma yoxdur.
- `a11y.py --econ` ilk icrada 45/46 verdi: 390 px-də "Suallar və sənədlər" tabında üfüqi daşma var idi (uzun
  sənəd növü adı seçim sahəsini 493 px-ə genişləndirirdi). Düzəldildi, sonra 46/46. `--econ` olmadan 24/24,
  iqtisadi hissə SKIP kimi yazılır.
- `a11y.py`-da "End → Agentlər" yoxlaması "End → son görünən tab" ilə əvəz olundu (1280 px-də Agentlər
  "Daha çox" menyusundadır). Menyunun klaviatura yoxlamaları yalnız menyu göründükdə işləyir — demo
  səhifəsində bütün tablar sığdığı üçün bu icrada işləmədi; menyu CFG v2-də ayrıca yoxlanılıb (aşağıda).
- Tab zolağı və yapışqan ofsetlər CFG v2-də 1280, 974 və 375 px-də brauzerdə (CDP) yoxlanılıb — 36/36:
  zolaqda scroll və səhifədə üfüqi daşma yoxdur, 9 taba keçid mümkündür (zolaq + menyu), nişanlı tab
  menyuya düşmür, `?tab=agentler` / `muqayise` / `elave` açılır və düymədə adı görünür, menyu klaviatura
  ilə açılıb-bağlanır, filtr sətirləri zolağın düz altında (0 px), keçidlər hədəfi zolağın/filtrin
  altında qoymur, konsolda xəta yoxdur. İlk icrada 1280 px-də zolaq 33 px daşırdı (Inter şrifti
  yüklənəndən sonra tablar genişlənirdi) — `document.fonts.ready` və ResizeObserver ilə düzəldildi.
- İqtisadi təhlil və Suallar tabları CFG v2-də 1280 və 375 px-də brauzerdə (CDP) yoxlanılıb: konsolda
  xəta yoxdur, üfüqi daşma yoxdur; test Excel modeli UI-dan yükləndi, plan ↔ model fərqləri (NPV, gəlir,
  `#REF!`) və Müqayisə tabında "əvvəl/sonra" göründü.
- Brauzer testləri saxta modelli serverdə (8011) və demo rejimində (8010) aparılıb.
- `pytest` icrasından əvvəl və sonra real `data/` qovluğu müqayisə olunub: fayllar, ölçülər və vaxtlar eynidir.
- **Bu yekun qəbulda real model və LangSmith yoxlanılmayıb.** Real modellə yeganə yoxlama aşağıda,
  "Real məhdudiyyətlər" bölməsində təsvir olunub; ayrıca icazə ilə edilib.

## İnterfeys

- Sol naviqasiya: yeni yoxlama, planlar və versiyalar (skeleton ilə yüklənir), seçilmiş planın statusu;
  mobil ekranda açılıb-bağlanan menyu.
- Nəticə: plan, fayl, versiya; sadə **status etiketi** (mətn + işarə ilə, yalnız rənglə deyil) və
  "Yoxlama tamamlandı · tarix"; tablar **Nəticə / Maliyyə / İqtisadi təhlil / Standart tələblər / Əlavə tələblər /
  Boş yerlər / Suallar və sənədlər / Müqayisə / Agentlər**; "Standart tələblər" tabında tələblər xəritəsi; sətrə klik → dəlil paneli;
  "Hesabatı çap et" (A4 çap görünüşü).
- Qrafiklər: kitabxanasız SVG (`static/charts.js`) — cəmi 4 sadə qrafik, asılılıq və şəbəkə tələb etmir.
  Bütün hesablamalar (kumulyativ axın, paylar) Python-dadır (`chart_data`). Məlumat çatmırsa qrafik qurulmur.
- Əlçatanlıq: tablar ox düymələri ilə (roving tabindex); detal panelində fokus tələsi, arxa fon `inert`,
  bağlananda fokus qayıdır; görünən fokus; `prefers-reduced-motion`; mətn kontrastı ≥ 4,5:1;
  sənəd və model mətni yalnız `textContent` ilə (innerHTML yoxdur).
- Server faiz və ya qalan vaxt vermir — interfeys də göstərmir; agentin daxili düşüncəsi göstərilmir.
- **Düzəliş siyahısı yığcamdır:** ilk 6 kart görünür, qalanları "Daha N bənd göstər" ilə açılır
  (`aria-expanded`), heç bir bənd gizli qalmır. Saylar və kart qaydaları:
  [Nəticə tabı: saylar və düzəliş kartları](#nəticə-tabı-saylar-və-düzəliş-kartları).
- **Stress yoxlaması:** 60 simvollu plan adı, 14 uzun əlavə tələb, 6 problem; 390 / 768 / 1440 px.
  Əvvəl və sonra görüntüləri: `docs/screenshots/merhele3/`.

## Real məhdudiyyətlər

- **Real model ilə bir yükləmə yoxlanılıb** (5 oktyabr 2026, `claude-sonnet-5`, `plan_demo_v1.docx` +
  3 bəndlik tələb faylı, içində zərərli təlimat sətri). İlk cəhddə 2 maliyyə rəqəmi və 2 tələb sitatı
  **yalançı rədd** edildi: model sitatı "..." ilə qısaldır, cədvəlin uzaq sətirlərini birləşdirir və
  "3 növbə (növbə 8 saat)" kimi bərabər məsafəli sitat verir. Tutuşdurma buna uyğunlaşdırıldı (hissələr
  hərfi və eyni ardıcıllıqla olmalıdır; bərabərlikdə isimdən əvvəlki say) və bu real sitatlar regression
  testinə çevrildi. Düzəlişdən sonra yaddaşdakı eyni model cavabları ilə: 14/14 rəqəm mənbəli, 7/7
  maliyyə yoxlaması aparıldı (NPV 1 226 599 — 11,49% ilə), sitatı rədd edilən tələb yoxdur, əlavə tələblər
  düzgün çıxarıldı, zərərli sətirə əməl olunmadı, rəydə mənbəsiz rəqəm yoxdur. Bu, **bir** sənədlə
  yoxlamadır — fərqli quruluşlu planlarda yeni hallar çıxa bilər. LangSmith izləri sonradan ayrıca oxunub yoxlanılıb (bax: «Semantik yaddaş, açıq handoff və LangSmith»).
- Mənbə yoxlaması açar söz + "ən yaxın rəqəm" qaydasına əsaslanır (`FIELD_KEYWORDS`); fərqli ifadə
  tərzli planlarda bəzi doğru rəqəmlər də rədd edilə bilər.
- Sabitləşdirmə (mətni dəyişməyən bölmədə əvvəlki status) yalnız istinad edilən bölmələrə baxır; cavab
  istinad edilməyən bölmədə dəyişibsə, bunu görməyə bilər.
- Düzəliş kartlarının birləşdirilməsi (eyni cədvəl + mövzuda ortaq söz kökü) və tövsiyənin tapıntıdan
  qurulması ("göstərilməyib", "doldurulmayıb", "boş qalıb" və s. feillər üzrə) evristikadır. Fərqli
  ifadə olunmuş tapıntıda şablon tövsiyə göstərilir, mənaca yaxın amma fərqli sözlü iki tələb ayrı
  kartda qala bilər. Saylar buna görə dəyişmir: kartlar və göstəricilər eyni mənbədən hesablanır.
- **İqtisadi təhlil real modellə hələ tam yoxlanılmayıb.** CFG v2-də iki real cəhd agentin addım
  limitinə çatdı (40, sonra 120 — model ~30 cədvəli alətlə bir-bir oxuyurdu); agent dəyişdirildi
  (cədvəllər tapşırıqda verilir), üçüncü cəhd isə API balansı bitdiyi üçün alınmadı. CFG v2-dəki nəticədə
  yerlər (hansı cədvəl, sətir, sütun) **əl ilə** verilib — bu, tabda sarı qeyd kimi görünür; rəqəmləri
  yenə Python sənəddən oxuyub yoxlayıb. Balans bərpa olunanda "Yenidən oxu (model ilə)" ilə model
  yoxlanılmalıdır.
- Həssaslıq sadələşdirilmişdir (vergi effekti və qalıq dəyər dəyişmir): qiymət −10% və xammal +10%
  ssenariləri CFG v2-də planın öz həssaslıq cədvəlinə yaxındır (−18,9 / −13,0 mln ↔ −18,1 / −12,8 mln),
  capex +15% isə fərqlənir (kod −0,27 mln; planın tam modelində NPV müsbət qalır).
- Benchmark faylında mənbələr doldurulmayıb — reallıq yoxlaması hazırda heç bir göstəricini yoxlamır.
- Tab zolağının yerləşməsi brauzerdə ölçü ilə seçilir (`layoutTabs`): şrift, nişan sayı və ya ad dəyişəndə
  mərhələ fərqli ola bilər; 974 px-də 6 əsas tab sıx rejimdə sığır, daha uzun ad əlavə olunarsa kompakt
  rejimə (aktiv tab + menyu) keçə bilər. Sıx rejimdəki aralıq `:has()` seçicisi ilə verilir (köhnə
  brauzerdə yalnız 2 px fərq edir).
- Excel modelində göstəricilər etiket mətninə görə tapılır (NPV, IRR, "özünü ödəmə", "ümumi investisiya",
  "satış gəliri"); fərqli adlandırılmış modeldə "modeldə tapılmadı" yazıla bilər. Düsturun dəyəri faylda
  saxlanmayıbsa (Excel-də açılıb saxlanmayıb), müqayisə aparılmır.
- OCR yoxdur; şifrəli PDF qəbul edilmir; TXT yalnız UTF-8/UTF-16.
- Tələblər siyahısı daxili siyahıdır, rəsmi mənbə ilə tutuşdurulmayıb.
- Bir istifadəçi üçün nəzərdə tutulub; autentifikasiya yoxdur. Yalnız baza (birinci) ssenari yoxlanılır;
  10 illik hesabatlar fərziyyələrdən yenidən qurulmur.
- `samples/` faylları istifadəçinin `input/` sənədindən yaradılmış anonim demo planlardır.
- Şriftlər Google Fonts-dan yüklənir; şəbəkə yoxdursa sistem şriftlərinə keçilir.
