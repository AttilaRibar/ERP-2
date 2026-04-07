-- ============================================================
-- SmartERP – Költségvetések újraseedelése fejezetekkel (Fejezet-demo)
-- Futtatás: az élő DB-n, MIUTÁN a schema.sql és 001_add_budget_sections.sql
-- már lefutott.
--
-- Törli a BUDGET-láncolat összes tábláját (budget_items, budget_sections,
-- versions, budgets), majd feltölti őket elektromos főköltségvetés-példával:
--
--   Elektromos főköltségvetés (Corvin B – 1. projekt)
--   └── v1.0 – Ajánlati
--         ├── Erősáram
--         │     ├── Védőcsövek
--         │     ├── Kábelek, vezetékek
--         │     └── Szerelvények
--         ├── Gyengeáram
--         ├── Tűzjelző
--         └── Villámvédelem
--   └── v1.1 – Pótmunkás módosítás  (delta: 2 tétel módosul, 1 fejezetbe helyezve)
--   └── v1.2 – Jóváhagyott végleges (delta: árkorrekció + 1 tétel fejezetet vált)
--
--   Épületgépészet (Corvin B – 1. projekt)
--   └── v1.0 – Vízvezeték és fűtés
--         ├── Vízvezeték
--         └── Fűtés/Hűtés
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Törlés (csak budget-lánc – partners/projects/quotes maradnak)
-- ============================================================
TRUNCATE TABLE budget_items, budget_sections, versions, budgets
    RESTART IDENTITY CASCADE;

-- ============================================================
-- 2. BUDGETS
-- ============================================================
INSERT INTO budgets (id, project_id, name) OVERRIDING SYSTEM VALUE VALUES
(1, 1, 'Corvin B épület – Elektromos főköltségvetés'),
(2, 1, 'Corvin B épület – Épületgépészeti kv.'),
(3, 2, 'Debreceni Lakópark – Összköltségvetés');

-- Szekvenszet visszaállítjuk a manuálisan beírt ID után
SELECT setval(pg_get_serial_sequence('budgets','id'), 3, true);

-- ============================================================
-- 3. VERSIONS
-- ============================================================
INSERT INTO versions (id, budget_id, parent_id, version_name) OVERRIDING SYSTEM VALUE VALUES
-- Budget 1: Elektromos
(1, 1, NULL, 'v1.0 – Ajánlati'),
(2, 1,    1, 'v1.1 – Pótmunkás módosítás'),
(3, 1,    2, 'v1.2 – Jóváhagyott végleges'),
-- Budget 2: Épületgépészet
(4, 2, NULL, 'v1.0 – Vízvezeték és fűtés'),
-- Budget 3: Debreceni Lakópark
(5, 3, NULL, 'v1.0 – Előzetes általános');

SELECT setval(pg_get_serial_sequence('versions','id'), 5, true);

-- ============================================================
-- 4. BUDGET SECTIONS (Version 1: Elektromos v1.0)
--
-- Fa-struktúra:
--   Erősáram           (sec-A)
--     Védőcsövek       (sec-A1) → parent: sec-A
--     Kábelek, vez.    (sec-A2) → parent: sec-A
--     Szerelvények     (sec-A3) → parent: sec-A
--   Gyengeáram         (sec-B)
--   Tűzjelző           (sec-C)
--   Villámvédelem      (sec-D)
-- ============================================================

-- Rögzített UUID-k – ezekre hivatkozunk a tételekben is
-- (v1.0 tárolja a teljes fejezet-struktúrát, mert nincs szülő-verzió)

INSERT INTO budget_sections
    (version_id, section_code,                              parent_section_code,                         name,                    sequence_no)
VALUES
-- Gyökérfejezetek
(1, 'aa000000-0001-0000-0000-000000000000', NULL,                                                        'Erősáram',              10),
(1, 'aa000000-0002-0000-0000-000000000000', NULL,                                                        'Gyengeáram',            20),
(1, 'aa000000-0003-0000-0000-000000000000', NULL,                                                        'Tűzjelző',              30),
(1, 'aa000000-0004-0000-0000-000000000000', NULL,                                                        'Villámvédelem',         40),
-- Erősáram alfejezetek
(1, 'aa000000-0001-0001-0000-000000000000', 'aa000000-0001-0000-0000-000000000000',                      'Védőcsövek',            11),
(1, 'aa000000-0001-0002-0000-000000000000', 'aa000000-0001-0000-0000-000000000000',                      'Kábelek, vezetékek',    12),
(1, 'aa000000-0001-0003-0000-000000000000', 'aa000000-0001-0000-0000-000000000000',                      'Szerelvények',          13);

-- ============================================================
-- 5. BUDGET SECTIONS (Version 4: Épületgépészet v1.0)
-- ============================================================
INSERT INTO budget_sections
    (version_id, section_code,                              parent_section_code,                         name,                    sequence_no)
VALUES
(4, 'bb000000-0001-0000-0000-000000000000', NULL,                                                        'Vízvezeték',            10),
(4, 'bb000000-0002-0000-0000-000000000000', NULL,                                                        'Fűtés / Hűtés',         20);

-- ============================================================
-- 6. BUDGET ITEMS – Version 1 (Elektromos v1.0 – teljes alaplap)
--
-- Erősáram / Védőcsövek   → sec-A1
-- Erősáram / Kábelek      → sec-A2
-- Erősáram / Szerelvények → sec-A3
-- Gyengeáram              → sec-B
-- Tűzjelző                → sec-C
-- Villámvédelem           → sec-D
-- ============================================================
INSERT INTO budget_items
    (version_id, item_code,                                 sequence_no, item_number, name,
     quantity,   unit,    material_unit_price, fee_unit_price, notes,                              section_code)
VALUES

-- ---- Erősáram / Védőcsövek (sec-A1) ----
(1, 'e1000001-0000-0000-0000-000000000001',  10, 'E1.1.01',
    'PVC védőcső D20 falba süllyesztve',
     480.0000, 'm',      320.00,   180.00, '',
     'aa000000-0001-0001-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000002',  20, 'E1.1.02',
    'PVC védőcső D25 álmennyezeti',
     620.0000, 'm',      390.00,   200.00, '',
     'aa000000-0001-0001-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000003',  30, 'E1.1.03',
    'Száraz betonos védőcső D40 – padló alatti',
     180.0000, 'm',      750.00,   380.00, 'Fugázott, kötődobozzal',
     'aa000000-0001-0001-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000004',  40, 'E1.1.04',
    'Kábelcsatorna 60×40 acél – szerver szoba',
     120.0000, 'm',     1850.00,   420.00, '',
     'aa000000-0001-0001-0000-000000000000'),

-- ---- Erősáram / Kábelek, vezetékek (sec-A2) ----
(1, 'e1000001-0000-0000-0000-000000000010',  50, 'E1.2.01',
    'CYKY 3×2,5 mm² kábel – általános körök',
    3200.0000, 'm',      420.00,   120.00, '',
     'aa000000-0001-0002-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000011',  60, 'E1.2.02',
    'CYKY 5×10 mm² tápkábel – főelosztóból',
     580.0000, 'm',     1650.00,   280.00, '',
     'aa000000-0001-0002-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000012',  70, 'E1.2.03',
    'YKY 4×16 mm² szabadtéri tápkábel',
     140.0000, 'm',     2900.00,   380.00, 'Homokba fektetve, téglasor',
     'aa000000-0001-0002-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000013',  80, 'E1.2.04',
    'Emeleti kábelállvány GKS 200/60 horganyzott',
     340.0000, 'm',     4200.00,   850.00, 'Konzollal, véglemezzel',
     'aa000000-0001-0002-0000-000000000000'),

-- ---- Erősáram / Szerelvények (sec-A3) ----
(1, 'e1000001-0000-0000-0000-000000000020',  90, 'E1.3.01',
    'Villamos főelosztó 630A (ABB) beépítve',
       1.0000, 'db', 2850000.00, 480000.00, 'IEC 61439, IP54, készre kötve',
     'aa000000-0001-0003-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000021', 100, 'E1.3.02',
    'Emeleti alelosztó 160A, 4-soros',
       6.0000, 'db',  320000.00,  85000.00, '',
     'aa000000-0001-0003-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000022', 110, 'E1.3.03',
    'Csatlakozóaljzat kettes S-line (keret+aljzat+befoglaló)',
     380.0000, 'db',    4200.00,   1800.00, '',
     'aa000000-0001-0003-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000023', 120, 'E1.3.04',
    'Kapcsoló egyes S-line',
     180.0000, 'db',    2800.00,   1200.00, '',
     'aa000000-0001-0003-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000024', 130, 'E1.3.05',
    'LED mennyezeti lámpatest 36W/4000K',
     220.0000, 'db',   38000.00,   9500.00, 'Be- és kikötéssel',
     'aa000000-0001-0003-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000025', 140, 'E1.3.06',
    'Vészvilágítás önálló, 3h (IP65)',
      48.0000, 'db',   22000.00,   5500.00, '',
     'aa000000-0001-0003-0000-000000000000'),

-- ---- Gyengeáram (sec-B) ----
(1, 'e1000001-0000-0000-0000-000000000030', 150, 'E2.01',
    'Cat6 UTP kábel hálózathoz',
    2800.0000, 'm',      580.00,   120.00, '',
     'aa000000-0002-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000031', 160, 'E2.02',
    'Hálózati patch panel 24 port, 1U',
      12.0000, 'db',   32000.00,  12000.00, '',
     'aa000000-0002-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000032', 170, 'E2.03',
    'Hálózati kapcsoló 24 port PoE (managed)',
       4.0000, 'db',  285000.00,  38000.00, '',
     'aa000000-0002-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000033', 180, 'E2.04',
    'Beléptető kártyaolvasó ajtónként (teljes rendszer)',
      12.0000, 'db',   95000.00,  28000.00, '13,56 MHz RFID',
     'aa000000-0002-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000034', 190, 'E2.05',
    'IP kamera rendszer (kamera + rögzítő)',
       1.0000, 'rend', 1650000.00, 320000.00, '16 kamera, 30 napos tárolás',
     'aa000000-0002-0000-0000-000000000000'),

-- ---- Tűzjelző (sec-C) ----
(1, 'e1000001-0000-0000-0000-000000000040', 200, 'E3.01',
    'Tűzjelző központ 4 hurok (analóg-címzett)',
       1.0000, 'db', 1250000.00, 185000.00, 'EN 54-2/4 tanúsított',
     'aa000000-0003-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000041', 210, 'E3.02',
    'Optikai füstérzékelő',
      96.0000, 'db',    8500.00,   2800.00, '',
     'aa000000-0003-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000042', 220, 'E3.03',
    'Kézi jelzésadó',
      24.0000, 'db',    5200.00,   1800.00, '',
     'aa000000-0003-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000043', 230, 'E3.04',
    'Tűzjelző JH1×2×0,8 kábel',
    1800.0000, 'm',      320.00,   110.00, '',
     'aa000000-0003-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000044', 240, 'E3.05',
    'Hang-fényjelző beltéri',
      18.0000, 'db',    6800.00,   2200.00, '',
     'aa000000-0003-0000-0000-000000000000'),

-- ---- Villámvédelem (sec-D) ----
(1, 'e1000001-0000-0000-0000-000000000050', 250, 'E4.01',
    'Villámfogó rúd h=2m – tetőn',
       8.0000, 'db',   18000.00,   9500.00, 'AlMgSi ötvözet',
     'aa000000-0004-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000051', 260, 'E4.02',
    'Levezetőhuzal Cu 50mm² tetőn',
     420.0000, 'm',     3200.00,    850.00, 'Kapoccsal rögzítve',
     'aa000000-0004-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000052', 270, 'E4.03',
    'Levezetőhuzal Cu 50mm² falon',
     340.0000, 'm',     3200.00,   1100.00, 'Falhoz rögzítve, mérési idommal',
     'aa000000-0004-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000053', 280, 'E4.04',
    'Földelő gyűrű Cu 50mm² talplemezbe beágyazva',
     380.0000, 'm',     3200.00,   1800.00, '',
     'aa000000-0004-0000-0000-000000000000'),

(1, 'e1000001-0000-0000-0000-000000000054', 290, 'E4.05',
    'TVM túlfeszültség-levezető (T1+T2 kombináció)',
       4.0000, 'db',   95000.00,  28000.00, 'Főelosztóba',
     'aa000000-0004-0000-0000-000000000000');

-- ============================================================
-- 7. BUDGET ITEMS – Version 2 (v1.1 – Pótmunkás módosítás – DELTA)
--
-- Változások:
--   • Kamera rendszer bővül (+8 kamera) – ár módosul  [Gyengeáram]
--   • Egy kézi jelzésadó tétel beágyazottabb lesz      [Tűzjelző – marad]
--   • Új tétel: UPS rendszer                           [Gyengeáram – ÚJ]
--   • Beléptető mennyiség növekszik 12→18 db           [Gyengeáram]
-- ============================================================
INSERT INTO budget_items
    (version_id, item_code,                                 sequence_no, item_number, name,
     quantity,   unit,    material_unit_price, fee_unit_price, notes,                              section_code)
VALUES

-- IP kamera rendszer bővítve (Gyengeáram – sec-B) [módosítás: ár+megjegyzés]
(2, 'e1000001-0000-0000-0000-000000000034', 190, 'E2.05',
    'IP kamera rendszer (kamera + rögzítő)',
       1.0000, 'rend', 2250000.00, 340000.00, '24 kamera, 30 napos tárolás – pótmunka bővítés',
     'aa000000-0002-0000-0000-000000000000'),

-- Beléptető mennyiség módosítás (Gyengeáram – sec-B)
(2, 'e1000001-0000-0000-0000-000000000033', 180, 'E2.04',
    'Beléptető kártyaolvasó ajtónként (teljes rendszer)',
      18.0000, 'db',   95000.00,  28000.00, '13,56 MHz RFID – 6 ajtóval bővítve',
     'aa000000-0002-0000-0000-000000000000'),

-- Új tétel: UPS rendszer (Gyengeáram – sec-B)
(2, 'e1000001-0000-0000-0000-000000000060', 195, 'E2.06',
    'Online UPS 10 kVA (szerver-szoba)',
       1.0000, 'db',  950000.00, 145000.00, 'Pótmunka: szerver igény pontosítása alapján',
     'aa000000-0002-0000-0000-000000000000');

-- ============================================================
-- 8. BUDGET ITEMS – Version 3 (v1.2 – Jóváhagyott végleges – DELTA)
--
-- Változások:
--   • Főelosztó árkorrekcó (Szerelvények – sec-A3)
--   • Egy füstérzékelő átkerül Gyengeáramba → fejezetet vált!
--     (Ezt demonstrálja a sectionChanged flag az összehasonlításban)
-- ============================================================
INSERT INTO budget_items
    (version_id, item_code,                                 sequence_no, item_number, name,
     quantity,   unit,    material_unit_price, fee_unit_price, notes,                              section_code)
VALUES

-- Főelosztó árkorrekció (Szerelvények – sec-A3)
(3, 'e1000001-0000-0000-0000-000000000020',  90, 'E1.3.01',
    'Villamos főelosztó 630A (ABB) beépítve',
       1.0000, 'db', 3100000.00, 510000.00, 'IEC 61439, IP54 – anyagár 2025Q1 korrekció',
     'aa000000-0001-0003-0000-000000000000'),

-- Optikai füstérzékelő FEJEZETET VÁLT: Tűzjelző → Gyengeáram
-- (Szándékos fejezet-mozgatás a verziókövetés demonstrálására)
(3, 'e1000001-0000-0000-0000-000000000041', 210, 'E3.02',
    'Optikai füstérzékelő (integrált BMS-be)',
      96.0000, 'db',    9200.00,   3100.00, 'BMS-integrációval – gyengeáramhoz átsorolva',
     'aa000000-0002-0000-0000-000000000000'); -- ← volt sec-C, most sec-B!

-- ============================================================
-- 9. BUDGET ITEMS – Version 4 (Épületgépészet v1.0)
-- ============================================================
INSERT INTO budget_items
    (version_id, item_code,                                 sequence_no, item_number, name,
     quantity,   unit,    material_unit_price, fee_unit_price, notes,                              section_code)
VALUES

-- ---- Vízvezeték (sec bb-1) ----
(4, 'f1000001-0000-0000-0000-000000000001',  10, 'G1.01',
    'Ivóvíz fővezeték DN100 horganyzott',
     120.0000, 'm',     4800.00,   2200.00, '',
     'bb000000-0001-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000002',  20, 'G1.02',
    'PP-R elosztóvezeték DN25',
     680.0000, 'm',     1650.00,    780.00, '',
     'bb000000-0001-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000003',  30, 'G1.03',
    'Sárgaréz csaptelep mosdóhoz',
     180.0000, 'db',    8500.00,   2800.00, '',
     'bb000000-0001-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000004',  40, 'G1.04',
    'Szifonos padlólefolyó DN50 (liftakna)',
      24.0000, 'db',    4200.00,   1900.00, '',
     'bb000000-0001-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000005',  50, 'G1.05',
    'Duálflush WC tartállyal beépítve',
     180.0000, 'db',   42000.00,  12000.00, '',
     'bb000000-0001-0000-0000-000000000000'),

-- ---- Fűtés / Hűtés (sec bb-2) ----
(4, 'f1000001-0000-0000-0000-000000000010',  60, 'G2.01',
    'Padlófűtés osztódoboz HKV 10 körös',
      18.0000, 'db',   85000.00,  24000.00, '',
     'bb000000-0002-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000011',  70, 'G2.02',
    'Padlófűtő cső PEX-a 17mm',
    8200.0000, 'm',      980.00,    320.00, 'REHAU',
     'bb000000-0002-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000012',  80, 'G2.03',
    'Kondenzációs gázkazán 80 kW',
       2.0000, 'db',  780000.00, 185000.00, 'Viessmann Vitodens 200',
     'bb000000-0002-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000013',  90, 'G2.04',
    'Fancoil egység mennyezeti (4 csöves)',
      36.0000, 'db',  145000.00,  38000.00, '',
     'bb000000-0002-0000-0000-000000000000'),

(4, 'f1000001-0000-0000-0000-000000000014', 100, 'G2.05',
    'Hűtő split egység 12 kW (külső+belső)',
       8.0000, 'db',  420000.00,  95000.00, 'Szerverszoba és tárgyalók',
     'bb000000-0002-0000-0000-000000000000');

-- ============================================================
-- 10. BUDGET ITEMS – Version 5 (Debreceni Lakópark v1.0 – fejezetek nélkül)
--     Ezt szándékosan hagyjuk section nélkül, hogy lehessen látni
--     a kezelőfelületen a besorolatlan tételeket.
-- ============================================================
INSERT INTO budget_items
    (version_id, item_code,                                 sequence_no, item_number, name,
     quantity,   unit,    material_unit_price, fee_unit_price, notes,                              section_code)
VALUES
(5, 'c0000001-0000-0000-0000-000000000001',  10, '1.1', 'Tereprendezés és humuszolás',
   12000.0000, 'm²',  1200.00,    800.00, '', NULL),
(5, 'c0000001-0000-0000-0000-000000000002',  20, '1.2', 'Cölöpalapozás fúrt cölöp D600mm',
     240.0000, 'fm',    0.00,  28000.00, '', NULL),
(5, 'c0000001-0000-0000-0000-000000000003',  30, '1.3', 'Alaplemez vasbeton C25/30',
    1200.0000, 'm³', 38000.00,  11000.00, '', NULL),
(5, 'c0000001-0000-0000-0000-000000000004',  40, '2.1', 'Falazat – Porotherm 30',
    8500.0000, 'm²',  5800.00,   3200.00, '', NULL),
(5, 'c0000001-0000-0000-0000-000000000005',  50, '2.2', 'Vasbeton magszerkezet',
     680.0000, 'm³', 43000.00,  14500.00, '', NULL),
(5, 'c0000001-0000-0000-0000-000000000006',  60, '3.1', 'Vízvezeték-rendszer lakásonként',
     180.0000, 'lak',  0.00,  185000.00, 'Lakásonkénti átalány', NULL),
(5, 'c0000001-0000-0000-0000-000000000007',  70, '3.2', 'Padlófűtés',
     180.0000, 'lak',  0.00,  220000.00, 'Lakásonkénti átalány', NULL),
(5, 'c0000001-0000-0000-0000-000000000008',  80, '4.1', 'Lift beépítése (8 személyes)',
       6.0000, 'db', 6800000.00, 420000.00, '', NULL);

COMMIT;

-- ============================================================
-- ELLENŐRZÉS (opcionális – futtatható a commit után)
-- ============================================================
/*
SELECT b.name AS budget, v.version_name, COUNT(bi.id) AS items,
       ROUND(SUM(bi.quantity * bi.material_unit_price)::NUMERIC, 0) AS anyag_osszesen,
       ROUND(SUM(bi.quantity * bi.fee_unit_price)::NUMERIC, 0)      AS dij_osszesen
FROM budgets b
JOIN versions v ON v.budget_id = b.id
JOIN budget_items bi ON bi.version_id = v.id AND NOT bi.is_deleted
GROUP BY b.name, v.version_name ORDER BY b.name, v.version_name;

SELECT v.version_name, s.parent_section_code IS NULL AS is_root,
       s.name AS section, COUNT(bi.id) AS tetelek
FROM versions v
JOIN budget_sections s ON s.version_id = v.id
LEFT JOIN budget_items bi ON bi.section_code = s.section_code
GROUP BY v.version_name, is_root, s.name ORDER BY v.version_name, s.sequence_no;
*/
