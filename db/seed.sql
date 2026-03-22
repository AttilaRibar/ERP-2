-- ============================================================
-- SmartERP – Tesztadatok (seed)
-- Futtasd a schema.sql UTÁN!
-- ============================================================

BEGIN;

-- Reset tables and restart identity sequences for idempotent seeding
TRUNCATE TABLE budget_items, versions, budgets, quotes, projects, partners
    RESTART IDENTITY CASCADE;

-- ============================================================
-- PARTNERS (10 partner: 4 megrendelő, 4 alvállalkozó, 2 szállító)
-- ============================================================
INSERT INTO partners (name, email, phone, address, tax_number, partner_type) VALUES
-- Megrendelők (client)
('Budapest Városfejlesztési Zrt.',  'info@bvfz.hu',            '+36 1 234 5678',  '1051 Budapest, Vörösmarty tér 1.',             '12345678-2-41', 'client'),
('Debrecen Városfejlesztési Kft.',  'beruhazas@debrecen.hu',   '+36 52 512 100',  '4024 Debrecen, Piac utca 20.',                  '15370009-2-09', 'client'),
('OTP Ingatlan Kft.',               'epites@otpingatlan.hu',   '+36 1 456 7890',  '1051 Budapest, Nádor utca 16.',                 '10537914-2-44', 'client'),
('Mol Energetika Kft.',             'tender@mol.hu',           '+36 1 567 8901',  '1117 Budapest, Október huszonharmadika u. 18.', '10625790-2-44', 'client'),
-- Alvállalkozók (subcontractor)
('ÉpítőMester Kft.',               'info@epitomester.hu',     '+36 1 234 1111',  '1097 Budapest, Könyves Kálmán krt. 12.',       '22345678-2-41', 'subcontractor'),
('Betontech Zrt.',                  'ajanlat@betontech.hu',    '+36 25 456 789',  '2400 Dunaújváros, Ipari út 5.',                 '33456789-2-07', 'subcontractor'),
('VillanyMester Kft.',              'offer@villanymester.hu',  '+36 1 345 2222',  '1138 Budapest, Váci út 112.',                   '44567890-2-41', 'subcontractor'),
('Tető & Sziget Bt.',               'info@tetoszigetelo.hu',   '+36 96 321 654',  '9024 Győr, Munkácsy utca 3.',                   '55678901-1-08', 'subcontractor'),
-- Szállítók (supplier)
('Würth Magyarország Kft.',         'ertekesites@wurth.hu',    '+36 1 801 8100',  '2040 Budaörs, Gyár utca 2.',                    '10488875-2-13', 'supplier'),
('Baumit Kft.',                     'sales@baumit.hu',         '+36 22 537 600',  '8000 Székesfehérvár, Széchenyi utca 52.',       '10282805-2-07', 'supplier');

-- ============================================================
-- PROJECTS (4 projekt)
-- Sorrend: name, start_date, end_date, client_id, warranty_months, status
-- ============================================================
INSERT INTO projects (name, start_date, end_date, client_id, warranty_months, status) VALUES
('Corvin Irodaközpont – B épület',    '2024-03-01', '2025-06-30', 1, 24, 'active'),
('Debreceni Lakópark – I. ütem',      '2024-06-01', '2025-12-31', 2, 36, 'active'),
('OTP Logisztikai Centrum – Győr',    '2023-09-01', '2024-12-15', 3, 12, 'completed'),
('M7 Csomóponti Ipari Csarnok',       '2025-01-15', '2026-08-31', 4, 24, 'active');

-- ============================================================
-- QUOTES (Ajánlatok)
-- Sorrend: project_id, subject, offerer_id, price, status, valid_until, notes
-- ============================================================

-- PRJ-0001: Corvin Irodaközpont
INSERT INTO quotes (project_id, subject, offerer_id, price, status, valid_until, notes) VALUES
(1, 'Vasbeton szerkezetek kivitelezése',         6, 145000000.00, 'accepted',  '2024-04-15', 'Elfogadva, szerződés aláírásra vár'),
(1, 'Villamos munkák – erős- és gyengeáram',    7,  38500000.00, 'accepted',  '2024-04-20', ''),
(1, 'Tetőszigetelésis és burkolati munkák',      8,  22000000.00, 'pending',   '2024-05-01', 'Pontosítás szükséges a tetőálló-lemez típusára'),
(1, 'Épületgépészeti szerelési munkák',          5,  41200000.00, 'rejected',  '2024-03-31', 'Ár nem versenyképes, új ajánlatot kértünk');

-- PRJ-0002: Debreceni Lakópark
INSERT INTO quotes (project_id, subject, offerer_id, price, status, valid_until, notes) VALUES
(2, 'Alapozás és vasbeton szerkezetek',                        6, 210000000.00, 'accepted', '2024-07-15', ''),
(2, 'Épületgépészeti munkák – vízvezeték, fűtés',              5,  65000000.00, 'pending',  '2024-07-30', 'Ajánlat felülvizsgálat alatt'),
(2, 'Villamos és intelligens épületrendszerek (BMS)',          7,  42000000.00, 'pending',  '2024-07-30', ''),
(2, 'Homlokzati hőszigetelés és vakolat (ETICS rendszer)',     5,  38600000.00, 'pending',  '2024-08-01', 'Porotherm falazathoz igazítva');

-- PRJ-0003: OTP Logisztikai Centrum
INSERT INTO quotes (project_id, subject, offerer_id, price, status, valid_until, notes) VALUES
(3, 'Acélszerkezet gyártás és helyszíni szerelés',             5,  88000000.00, 'accepted', '2023-10-01', 'Leszállítva és szerelve'),
(3, 'Trapézlemez tető- és homlokzatburkolat',                  8,  34000000.00, 'accepted', '2023-10-15', 'Kivitelezés befejezve'),
(3, 'Ipari betonpadló csiszolással és keményítéssel',          6,  21500000.00, 'accepted', '2023-10-20', '');

-- PRJ-0004: M7 Ipari Csarnok
INSERT INTO quotes (project_id, subject, offerer_id, price, status, valid_until, notes) VALUES
(4, 'Földmunkák és alapozás (CFG cölöpalapozás)',              6,  55000000.00, 'accepted', '2025-02-28', ''),
(4, 'Acélszerkezet kivitelezés – főtartók és másodlagos sz.', 5, 175000000.00, 'pending',  '2025-03-15', 'Pontosítjuk az acélminőséget'),
(4, 'Tető- és homlokzatburkolat – szendvicspanel',             8,  48000000.00, 'pending',  '2025-03-20', '');

-- ============================================================
-- BUDGETS (Költségvetések – projektenként 1-2 db)
-- ============================================================
INSERT INTO budgets (project_id, name) VALUES
(1, 'Corvin B épület – Ajánlati költségvetés'),      -- id=1
(1, 'Corvin B épület – Megvalósítási kv.'),           -- id=2
(2, 'Debreceni Lakópark – Összköltségvetés'),         -- id=3
(3, 'OTP Logisztikai Centrum – Kiviteli kv.'),        -- id=4
(4, 'M7 Ipari Csarnok – Beruházói kv.');              -- id=5

-- ============================================================
-- VERSIONS (Verziók – parent_id NULL = gyökér)
-- ============================================================
INSERT INTO versions (budget_id, parent_id, version_name) VALUES
-- Budget 1: Corvin – Ajánlati
(1, NULL, 'v1.0 – Ajánlati'),                  -- id=1
(1,    1, 'v1.1 – Pótmunkás módosítás'),        -- id=2
(1,    2, 'v1.2 – Jóváhagyott végleges'),       -- id=3
-- Budget 2: Corvin – Megvalósítási
(2, NULL, 'v1.0 – Megvalósítási alap'),         -- id=4
-- Budget 3: Debreceni Lakópark
(3, NULL, 'v1.0 – Előzetes kalkuláció'),        -- id=5
(3,    5, 'v1.1 – Jóváhagyott tervek alapján'), -- id=6
-- Budget 4: OTP Logisztikai Centrum
(4, NULL, 'v1.0 – Kiviteli'),                   -- id=7
(4,    7, 'v1.1 – Pótmunka elszámolás'),        -- id=8
-- Budget 5: M7 Ipari Csarnok
(5, NULL, 'v1.0 – Tervezési fázis');            -- id=9

-- ============================================================
-- BUDGET ITEMS (Tételek – delta store)
-- item_code UUID alapján követjük a változásokat verziókon át
-- ============================================================

-- -------------------------------------------------------
-- Version 1: Corvin B – v1.0 Ajánlati
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(1, 'a1000000-0000-0000-0000-000000000001',  10, '1.1', 'Zsaluzat és állványzat',
    2500.0000, 'm²',  4200.00,  3800.00, 'Lemezzsaluzattal'),

(1, 'a1000000-0000-0000-0000-000000000002',  20, '1.2', 'Betonacél feldolgozás és beépítés',
     185.0000, 't',      0.00, 145000.00, 'B500B minőség'),

(1, 'a1000000-0000-0000-0000-000000000003',  30, '1.3', 'Beton C30/37 – alaplemez',
     850.0000, 'm³', 42000.00,  12000.00, 'Pumpával szállítva'),

(1, 'a1000000-0000-0000-0000-000000000004',  40, '1.4', 'Beton C30/37 – pillérek és falak',
     420.0000, 'm³', 43500.00,  15000.00, ''),

(1, 'a1000000-0000-0000-0000-000000000005',  50, '2.1', 'Homlokzati hőszigetelésis rendszer (ETICS)',
    3200.0000, 'm²',  8500.00,   4200.00, 'EPS 14 cm, hálóbetétes'),

(1, 'a1000000-0000-0000-0000-000000000006',  60, '2.2', 'Alumínium nyílászárók beépítése',
     120.0000, 'db', 95000.00,  18000.00, '3 rétegű üvegezés, hőhídmentes tok'),

(1, 'a1000000-0000-0000-0000-000000000007',  70, '3.1', 'Villamos főelosztó',
       1.0000, 'db', 1850000.00, 320000.00, '630A, IEC 61439'),

(1, 'a1000000-0000-0000-0000-000000000008',  80, '3.2', 'Kábelfektetés erősáram',
    4800.0000, 'm',    850.00,    420.00, 'CYKY 5x2.5, kábelcsatornában');

-- -------------------------------------------------------
-- Version 2: Corvin B – v1.1 Pótmunkás módosítás
-- (Delta: csak a változott/új tételek kerülnek be)
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

-- Módosított tétel: nagyobb homlokzati felület (qty változott)
(2, 'a1000000-0000-0000-0000-000000000005',  50, '2.1', 'Homlokzati hőszigetelésis rendszer (ETICS)',
    3450.0000, 'm²',  8500.00,   4200.00, 'EPS 14cm – tervmódosítás +250m²'),

-- Új tétel: tető vízszigetelés
(2, 'a1000000-0000-0000-0000-000000000009',  90, '4.1', 'Tető kétrétegű bitumenes vízszigetelés',
    1200.0000, 'm²',  6200.00,   2800.00, 'SBS modifikált 2×4mm'),

-- Új tétel: tetővillámvédelem
(2, 'a1000000-0000-0000-0000-000000000010', 100, '4.2', 'Villámvédelmi rendszer',
       1.0000, 'rend', 1250000.00, 280000.00, 'I. védelmi szint');

-- -------------------------------------------------------
-- Version 3: Corvin B – v1.2 Jóváhagyott végleges
-- (Delta: még egy tétel ár-korrekció)
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

-- Árkorrekció a betonnál (anyagár emelkedés)
(3, 'a1000000-0000-0000-0000-000000000003',  30, '1.3', 'Beton C30/37 – alaplemez',
     850.0000, 'm³', 45500.00,  12000.00, 'Pumpával – anyagár-korrekció 2024Q2');

-- -------------------------------------------------------
-- Version 4: Corvin Megvalósítási – v1.0 alap
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(4, 'b1000000-0000-0000-0000-000000000001',  10, '1.1', 'Zsaluzat és állványzat – tényleges',
    2610.0000, 'm²',  4200.00,   3800.00, 'Felmért tényleges mennyiség'),

(4, 'b1000000-0000-0000-0000-000000000002',  20, '1.2', 'Betonacél beépítés – tényleges',
     192.0000, 't',     0.00,  145000.00, ''),

(4, 'b1000000-0000-0000-0000-000000000003',  30, '1.3', 'Beton C30/37 – alaplemez tényleges',
     861.0000, 'm³', 45500.00,  12000.00, '');

-- -------------------------------------------------------
-- Version 5: Debreceni Lakópark – v1.0 Előzetes
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(5, 'c1000000-0000-0000-0000-000000000001',  10, '1.1', 'Tereprendezés és humuszolás',
   12000.0000, 'm²',  1200.00,    800.00, ''),

(5, 'c1000000-0000-0000-0000-000000000002',  20, '1.2', 'Cölöpalapozás fúrt cölöp D600mm',
     240.0000, 'fm',    0.00,  28000.00, ''),

(5, 'c1000000-0000-0000-0000-000000000003',  30, '1.3', 'Alaplemez vasbeton C25/30',
    1200.0000, 'm³', 38000.00,  11000.00, ''),

(5, 'c1000000-0000-0000-0000-000000000004',  40, '2.1', 'Falazat – Porotherm 30',
    8500.0000, 'm²',  5800.00,   3200.00, ''),

(5, 'c1000000-0000-0000-0000-000000000005',  50, '2.2', 'Vasbeton magszerkezet – pillérek, gerendák',
     680.0000, 'm³', 43000.00,  14500.00, ''),

(5, 'c1000000-0000-0000-0000-000000000006',  60, '3.1', 'Épületgépészet – vízvezeték-rendszer',
     180.0000, 'lak',   0.00, 185000.00, 'Lakásonkénti átalány'),

(5, 'c1000000-0000-0000-0000-000000000007',  70, '3.2', 'Fűtési rendszer – padlófűtés',
     180.0000, 'lak',   0.00, 220000.00, 'Lakásonkénti átalány'),

(5, 'c1000000-0000-0000-0000-000000000008',  80, '4.1', 'Liftek beépítése (4 személyes)',
       6.0000, 'db',  4200000.00, 380000.00, '');

-- -------------------------------------------------------
-- Version 6: Debreceni Lakópark – v1.1 Jóváhagyott
-- (Delta: cölöpszám növekedett, lift típusváltás)
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(6, 'c1000000-0000-0000-0000-000000000002',  20, '1.2', 'Cölöpalapozás fúrt cölöp D600mm',
     270.0000, 'fm',    0.00,  28000.00, 'Statikus szükséglet alapján +30fm'),

(6, 'c1000000-0000-0000-0000-000000000008',  80, '4.1', 'Liftek beépítése (8 személyes)',
       6.0000, 'db',  6800000.00, 420000.00, 'Típusváltás: 8 személyes panorámalift');

-- -------------------------------------------------------
-- Version 7: OTP Logisztikai Centrum – v1.0 Kiviteli
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(7, 'd1000000-0000-0000-0000-000000000001',  10, '1.1', 'Acélszerkezet gyártás S355',
     320.0000, 't',  520000.00,     0.00, 'Gyártás alvállalkozóval'),

(7, 'd1000000-0000-0000-0000-000000000002',  20, '1.2', 'Acélszerkezet helyszíni szerelés',
     320.0000, 't',      0.00,  95000.00, 'Darukkal, szerelési állvánnyal'),

(7, 'd1000000-0000-0000-0000-000000000003',  30, '2.1', 'Trapézlemez tetőhéjazat T150/280-0.75',
    4800.0000, 'm²',  4200.00,   1800.00, 'Horganyzott + festett'),

(7, 'd1000000-0000-0000-0000-000000000004',  40, '2.2', 'Hőszigetelt szendvicspanel homlokzat 10cm PIR',
    2200.0000, 'm²', 12500.00,   3500.00, ''),

(7, 'd1000000-0000-0000-0000-000000000005',  50, '3.1', 'Ipari betonpadló C30/37 szálerősített',
    6000.0000, 'm²',  8500.00,   3200.00, 'Polírozva, keményítőréteg'),

(7, 'd1000000-0000-0000-0000-000000000006',  60, '4.1', 'Szekcionált ipari kapu 5×5m',
      12.0000, 'db',  850000.00, 120000.00, 'Automatika nélkül');

-- -------------------------------------------------------
-- Version 8: OTP Logisztikai Centrum – v1.1 Pótmunka
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

-- Meglévő tétel törlése (megrendelő visszamondta az automatika nélkülit)
(8, 'd1000000-0000-0000-0000-000000000006',  60, '4.1', 'Szekcionált ipari kapu 5×5m',
      12.0000, 'db',  850000.00, 120000.00, 'TÖRÖLVE – kiváltva automata kapukkal'),

-- Új tétel: automata ipari kapu
(8, 'd1000000-0000-0000-0000-000000000007',  60, '4.1b', 'Szekcionált ipari kapu – automata nyitással',
      12.0000, 'db', 1150000.00, 145000.00, 'Pótmunka: automata meghajtás megrendelői kérésre'),

-- Új tétel: tűzjelző rendszer (pótmunka)
(8, 'd1000000-0000-0000-0000-000000000008',  70, '5.1', 'Tűzjelző rendszer – analóg-címzett',
       1.0000, 'rend', 4800000.00, 620000.00, 'EN 54 tanúsított');

-- Az előző verziós 4.1 tétel logikai törlése
UPDATE budget_items
SET is_deleted = TRUE
WHERE version_id = 8
  AND item_code  = 'd1000000-0000-0000-0000-000000000006';

-- -------------------------------------------------------
-- Version 9: M7 Ipari Csarnok – v1.0 Tervezési
-- -------------------------------------------------------
INSERT INTO budget_items (version_id, item_code, sequence_no, item_number, name,
    quantity, unit, material_unit_price, fee_unit_price, notes) VALUES

(9, 'e1000000-0000-0000-0000-000000000001',  10, '1.1', 'Kitermelt föld elszállítása',
    8000.0000, 'm³',    0.00,   2800.00, 'Engedélyezett lerakóhelyre'),

(9, 'e1000000-0000-0000-0000-000000000002',  20, '1.2', 'Talajerősítés – CFG cölöp D400mm',
     350.0000, 'fm',    0.00,  18500.00, 'Statikus szükséglet alapján'),

(9, 'e1000000-0000-0000-0000-000000000003',  30, '1.3', 'Zsaluzat és állványzat – alaplemez',
    2200.0000, 'm²',  4200.00,   3800.00, ''),

(9, 'e1000000-0000-0000-0000-000000000004',  40, '2.1', 'Acélszerkezet – főtartók S355',
     480.0000, 't',  540000.00,     0.00, ''),

(9, 'e1000000-0000-0000-0000-000000000005',  50, '2.2', 'Acélszerkezet – másodlagos szerkezetek',
     120.0000, 't',  520000.00,     0.00, ''),

(9, 'e1000000-0000-0000-0000-000000000006',  60, '3.1', 'Tető- és homlokzatszendvicspanel',
    6800.0000, 'm²',  9800.00,   3200.00, '12cm PIR hőszigetelés'),

(9, 'e1000000-0000-0000-0000-000000000007',  70, '4.1', 'Szekcionált ipari kapuk 6×7m',
       8.0000, 'db', 1200000.00, 150000.00, 'Automata meghajtással'),

(9, 'e1000000-0000-0000-0000-000000000008',  80, '4.2', 'Acél tolókapuk – tehergépjármű-forgalom',
       4.0000, 'db',  980000.00, 130000.00, '');

COMMIT;

-- ============================================================
-- ELLENŐRZŐ LEKÉRDEZÉSEK
-- ============================================================

-- Projekt összesítő
SELECT * FROM v_project_summary ORDER BY id;

-- Ajánlat részletek
SELECT * FROM v_quote_detail ORDER BY project_name, quote_code;

-- Verzió összesítők (összes tétel ártotalja)
SELECT * FROM v_version_totals ORDER BY project_name, budget_id, version_id;
