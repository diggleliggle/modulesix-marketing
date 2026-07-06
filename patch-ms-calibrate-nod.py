import sys, pathlib

P = pathlib.Path("calibrate.html")
if not P.exists():
    sys.exit("ABORT: calibrate.html not found. Run from the modulesix-marketing repo root.")
t = P.read_text(encoding="utf-8")

OLD_META = 'Calibrate is the competency and CPD platform employers run on the IPP framework. Team heat map, People Tools, consultant deployments. Seats from \u00a321.'
NEW_META = 'Calibrate is the competency and CPD platform for managing your workforce\u2019s real capability. A ready-made framework aligned to IPP governance, tailorable to your own or another body\u2019s. Team heat map, People Tools, consultant deployments. Seats from \u00a321.'
n = t.count(OLD_META)
if n != 2:
    sys.exit(f"ABORT [meta]: expected 2 identical meta descriptions, found {n}. Nothing changed.")
t = t.replace(OLD_META, NEW_META)

OLD_NOTE = 'Self-serve up to any band; for 51 seats and above, talk to us for assisted onboarding and an invoice.</p>'
NEW_NOTE = 'Self-serve up to any band; for 51 seats and above, talk to us for assisted onboarding and an invoice. Want the ready-made project-management standard, live and buyable today? That runs through IPP at <a href="https://ipp.pro/employers" target="_blank" rel="noopener">ipp.pro/employers</a>.</p>'
if t.count(OLD_NOTE) != 1:
    sys.exit(f"ABORT [note]: expected 1 pricing note ending, found {t.count(OLD_NOTE)}. Nothing changed.")
t = t.replace(OLD_NOTE, NEW_NOTE, 1)

P.write_text(t, encoding="utf-8")
print("OK: meta descriptions softened and IPP off-the-shelf nod added.")
