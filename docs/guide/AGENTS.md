# Working on Inside VOCO

This is the public-source visual study guide inside VOCO’s repository. The website runs locally; it is not a hosted service.

- Keep the app dependency-free: standard browser APIs, local assets, Python standard library and Git.
- Keep serving on loopback only. Never enable public hosting, analytics, external requests or a tunnel.
- Source comes from pinned Git blobs, not working files. Preserve the path allowlist, size bound, Host/Origin checks and read-only API.
- Explain one idea at a time: simple story first, implementation detail second, exact code links third. Define jargon in the glossary.
- Clearly mark simulations and limitations. Do not turn small benchmark samples into global accuracy or speed claims.
- Do not copy personal recordings, transcripts, benchmark logs or launch assets into this guide.
- Update authored lessons in tools/write_lessons.py; regenerate site/chapters.json. Fail if a cited path does not exist.
- Catalog all tracked files without pretending every vendor function has been individually explained.
- Preserve VOCO’s white/graphite/silver palette, Geist typography and silver microphone. Keep responsive layout, keyboard access and reduced-motion support.
- Before delivery, run the unittest suite, verify lesson regeneration, and test chapters, source modal, search, glossary, simulations and narrow layout in a browser.
- Do not modify or republish the pinned VOCO release as part of guide maintenance.
