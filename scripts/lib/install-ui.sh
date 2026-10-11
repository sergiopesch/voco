#!/usr/bin/env bash
# Embedded into the standalone installer by sync-installer-ui.py.
# Presentation never owns the download: the foreground waits on wget itself.
VOCO_UI_PID=""
VOCO_UI_TIMER_FD=""
VOCO_UI_OPEN=false
VOCO_UI_STAGE=0
VOCO_UI_TITLE="Getting your desktop ready."
VOCO_UI_NOTE=""
VOCO_UI_NO_MOTION=false
VOCO_UI_LAST_BYTES=0
VOCO_UI_LAST_TIME=0
VOCO_UI_RATES=(0 0 0 0 0 0 0)
VOCO_UI_LINES=10
# The art canvas: a graphite card holding the microphone and the wordmark, above
# eight progress lines. Card columns: 2 padding, 14 microphone, 3 gap, 37 for the
# wordmark and text, 2 padding; 11 rows between its rounded top and bottom edges.
VOCO_UI_ART=false
VOCO_UI_ART_BUILT=false
VOCO_UI_CARD_WIDTH=58
VOCO_UI_CARD_ROWS=11
VOCO_UI_ART_RIGHT=19
VOCO_UI_PROGRESS_LINES=8
# How the card shows the microphone: kitty, as an image through the kitty
# graphics protocol, or a mosaic of the octant, sextant or quadrant symbols the
# terminal draws itself. VOCO_INSTALL_ART picks one instead of asking.
VOCO_UI_MIC_MODE=''
# The terminal's answers: whether it shows kitty images, and its cell size in
# pixels, or 0 when it didn't say. The probe waits for them at most
# VOCO_UI_PROBE_MS, and keeps the terminal's settings to restore if interrupted.
VOCO_UI_GRAPHICS=''
VOCO_UI_CELL_WIDTH=0
VOCO_UI_CELL_HEIGHT=0
VOCO_UI_PROBE_MS=200
VOCO_UI_PROBE_TTY=''
# The image's fixed id ("VOCO" on a phone keypad), its placement once the sweep
# has revealed 1 to 14 of its columns, and the command that takes it away.
VOCO_UI_IMAGE_ID=8626
VOCO_UI_PLACE=()
VOCO_UI_UNPLACE=''
# True while the APT display draws, which an interrupt can stop mid-sequence.
VOCO_UI_APT_DRAWING=false
# The intro, in milliseconds after the canvas opens: a silver line crosses the
# card and leaves the microphone behind it, the letters glide in and lock, one
# shine passes, then the tagline writes itself in. It only ever paints frames;
# the installer never waits for it.
VOCO_UI_SWEEP_MS=480
VOCO_UI_GLIDE_AT=240
VOCO_UI_GLIDE_STEP=100
VOCO_UI_GLIDE_MS=360
VOCO_UI_GLIDE_COLUMNS=12
VOCO_UI_SHINE_AT=900
VOCO_UI_SHINE_MS=280
VOCO_UI_BRAND_AT=900
VOCO_UI_TODAY_AT=1050
VOCO_UI_VERSION_AT=1150
VOCO_UI_INTRO_MS=1300
VOCO_UI_INTRO_START=0
VOCO_UI_SHINE_START=0
VOCO_UI_NOW=0
VOCO_UI_FINAL_TOP=''
VOCO_UI_CARD_LEFT=()
VOCO_UI_CARD_RIGHT=()
VOCO_UI_CARD_REVEAL=0
VOCO_UI_CARD_SWEEP=0
VOCO_UI_CARD_KINDS=()
VOCO_UI_APT_CARD=''
VOCO_UI_APT_SHINE=''
VOCO_UI_SHOWN_SWEEP=-1
VOCO_UI_SHOWN_LEFT=-1
VOCO_UI_SHOWN_RIGHT=()
VOCO_UI_SHOWN_REVEAL=-1
VOCO_UI_SHOWN_RESTS=false
VOCO_UI_SHOWN_HEADING=''
VOCO_UI_SHOWN_LINES=()
VOCO_UI_SHOWN_PROGRESS=''
VOCO_UI_CARD_RESTS=false
VOCO_UI_PROGRESS=()
VOCO_UI_PROGRESS_KEY=''
VOCO_UI_BRAND_LINE='The voice layer for Linux.'
VOCO_UI_TODAY_LINE='Today: private dictation.'
# BEGIN GENERATED INSTALLER BRAND
VOCO_UI_GLYPHS=(
  '██    ██' ' ██████ ' ' ██████ ' ' ██████ '
  '██    ██' '██    ██' '██      ' '██    ██'
  ' ██  ██ ' '██    ██' '██      ' '██    ██'
  '  ████  ' '██    ██' '██      ' '██    ██'
  '   ██   ' ' ██████ ' ' ██████ ' ' ██████ '
)
VOCO_UI_SILVER='\033[38;2;199;204;212m'
VOCO_UI_MUTED='\033[38;2;122;128;138m'
VOCO_UI_COMPLETE='\033[38;2;165;217;178m'
VOCO_UI_ACTIVE='\033[38;2;239;206;131m'
VOCO_UI_CARD='17;19;24'
VOCO_UI_WORDMARK=('244;246;249' '233;236;240' '222;225;230' '210;214;221' '199;204;212' '188;193;202' '177;182;192' '165;172;181' '154;161;171' '143;150;161')
VOCO_UI_WORDMARK_SHINE=('255;255;255' '238;241;245')
VOCO_UI_SWEEP=('93;99;109' '225;229;236')
VOCO_UI_TEXT_BRAND='199;204;212'
VOCO_UI_TEXT_TODAY='174;181;191'
VOCO_UI_TEXT_VERSION='140;146;156'
VOCO_UI_EASE=(0 202 397 560 682 767 828 871 903 928 946 960 971 980 986 991 995 997 999 1000 1000)
# The microphone, from assets/voco-symbol.png by generate-installer-art.py: its
# palette, a mosaic of block symbols for each kind of terminal, and its image.
VOCO_UI_PALETTE=('17;19;24' '20;21;24' '27;27;30' '36;35;35' '41;40;40' '47;45;45' '51;49;49' '54;52;52' '57;55;55' '59;57;57' '61;59;60' '71;68;71' '84;80;81' '96;92;94' '107;103;104' '117;113;114' '127;123;124' '136;132;132' '142;139;139' '148;144;145' '153;150;150' '158;155;155' '164;161;161' '170;167;167' '177;174;173' '182;179;179' '188;185;184' '192;189;189' '196;193;193' '200;198;197' '205;202;202' '210;207;207' '214;211;211' '218;215;215' '222;220;219' '226;224;224' '231;229;228' '236;234;234' '242;240;240' '247;246;245')
VOCO_UI_MOSAIC_OCTANT=(
  ' 0000' ▁0100 🬆031d 𜴖1a09 ▅0821 ▕1322 ▅0722 ▅0822 ▏1121 ▅0920 𜴤1a0a 🬊031f ▏0200 ' 0000'
  ' 0000' ▕1902 ▊2206 𜴂0809 ▕0408 ▕0c24 ▏060a ▕0709 ▏0623 ▏0a09 ▌0a08 ▍0b24 ▏1f02 ' 0000'
  ' 0000' ▕1a02 ▋240c ▗0a0a ▕0409 ▕0c24 ▏060a ▕0609 ▏0523 ▏0a09 ▋0a09 ▍0a22 ▎1500 ' 0000'
  ' 0000' ▕1902 ▋230c 🬏090a ▕0408 ▕0b22 ▏060a ▕0709 ▏0521 ▍080a ▌0a08 ▍0a20 ▎1400 ' 0000'
  🬭2000 🬏1707 ▋200b 𜶻0809 ▕0408 ▕0b20 ▏0508 ▕0608 ▏051f ▎0608 🬆0807 ▍0a1e 🬞1a09 🬭2200
  ▏1924 ▎200d 𜴡0e1f ▂2206 ▂2405 ▕0e21 ▂2406 ▂2305 ▏0c1f ▂2105 ▂1e05 ▍0d1e ▊0e25 ▕1723
  ▏1823 ▎1c0c ▂1018 🬭1821 🬭1e26 🬭1f26 🬭1c23 🬭181f 🬭141b ▂1118 ▂1016 ▂131c ▊0c23 ▕1622
  ▏1021 ▎1b03 🬏0c14 𜴡1f18 🬏2025 𜷋2426 ▌2320 ▌1e1b 𜴍1a18 𜴍1716 ▊1517 🬞0d19 ▊0322 ▕101f
  𜴢1803 🬁051b 𜴷1603 𜶻0214 ▁0a18 ▀1f16 ▅181e 𜴼1915 🬂1613 ▁0814 𜷋0215 𜵱1603 🬀041b 𜴏1603
  ' 0000' 🬁1b03 𜶻031b 𜴳1d0c 🬂011a ▅190a ▔1423 𜵈1c13 ▅150a 🬂0119 𜴳1b0c 𜷋0219 🬀1903 ' 0000'
  ' 0000' ' 0000' ' 0000' 🬦1106 🬂0118 🬀0a1f ▁1e25 🬠171d 🬁0b15 🬂0115 🬓1407 ' 0000' ' 0000' ' 0000'
)
VOCO_UI_MOSAIC_SEXTANT=(
  ' 0000' ▁0100 🬆031d 🬅1b0c ▅0821 ▕1322 ▅0722 ▅0822 ▏1121 ▅0920 🬈1c0d 🬊031f ▏0200 ' 0000'
  ' 0000' ▕1902 ▊2206 ▆0908 ▕0408 ▕0c24 ▏060a ▕0709 ▏0623 ▏0a09 ▌0a08 ▍0b24 ▏1f02 ' 0000'
  ' 0000' ▕1a02 ▋240c ▗0a0a ▕0409 ▕0c24 ▏060a ▕0609 ▏0523 ▏0a09 ▋0a09 ▍0a22 ▎1500 ' 0000'
  ' 0000' ▕1902 ▋230c 🬏090a ▕0408 ▕0b22 ▏060a ▕0709 ▏0521 ▍080a ▌0a08 ▍0a20 ▎1400 ' 0000'
  🬭2000 🬏1707 ▋200b ▖0809 ▕0408 ▕0b20 ▏0508 ▕0608 ▏051f ▎0608 🬆0807 ▍0a1e 🬞1a09 🬭2200
  ▏1924 ▎200d ▋1f0e ▂2206 ▂2405 ▕0e21 ▂2406 ▂2305 ▏0c1f ▂2105 ▂1e05 ▍0d1e ▊0e25 ▕1723
  ▏1823 ▎1c0c ▂1018 🬭1821 🬭1e26 🬭1f26 🬭1c23 🬭181f 🬭141b ▂1118 ▂1016 ▂131c ▊0c23 ▕1622
  ▏1021 ▎1b03 🬏0c14 🬉1f19 🬏2025 ▂2425 ▌2320 ▌1e1b 🬄1a18 🬄1716 ▊1517 🬞0d19 ▊0322 ▕101f
  🬉1d09 🬁051b 🬑1202 ▃0413 ▁0a18 ▀1f16 ▅181e ▅161a 🬂1613 ▁0814 ▃0314 🬟1302 🬀041b 🬄1b08
  ' 0000' 🬁1b03 ▃031a 🬋1d0e 🬂011a ▅190a ▔1423 🬓1c13 ▅150a 🬂0119 🬋1b0e ▃0319 🬀1903 ' 0000'
  ' 0000' ' 0000' ' 0000' 🬦1106 🬂0118 🬀0a1f ▁1e25 🬠171d 🬁0b15 🬂0115 🬓1407 ' 0000' ' 0000' ' 0000'
)
VOCO_UI_MOSAIC_QUADRANT=(
  ' 0000' ▁0100 ▀0619 ▃0915 ▅0821 ▕1322 ▅0722 ▅0822 ▏1121 ▅0920 ▃0a16 ▅1803 ▏0200 ' 0000'
  ' 0000' ▕1902 ▊2206 ▆0908 ▕0408 ▕0c24 ▏060a ▕0709 ▏0623 ▏0a09 ▌0a08 ▍0b24 ▏1f02 ' 0000'
  ' 0000' ▕1a02 ▋240c ▗0a0a ▕0409 ▕0c24 ▏060a ▕0609 ▏0523 ▏0a09 ▋0a09 ▍0a22 ▎1500 ' 0000'
  ' 0000' ▕1902 ▋230c ▖090a ▕0408 ▕0b22 ▏060a ▕0709 ▏0521 ▍080a ▌0a08 ▍0a20 ▎1400 ' 0000'
  ▃1c00 ▕170a ▋200b ▖0809 ▕0408 ▕0b20 ▏0508 ▕0608 ▏051f ▎0608 ▃0708 ▍0a1e ▏180b ▃1d00
  ▏1924 ▎200d ▋1f0e ▂2206 ▂2405 ▕0e21 ▂2406 ▂2305 ▏0c1f ▂2105 ▂1e05 ▍0d1e ▊0e25 ▕1723
  ▏1823 ▎1c0c ▂1018 ▂1720 ▃1f26 ▃2026 ▃1c23 ▂171e ▂141a ▂1118 ▂1016 ▂131c ▊0c23 ▕1622
  ▏1021 ▎1b03 ▖0e15 ▌181e ▖2125 ▂2425 ▌2320 ▌1e1b ▌1918 ▌1715 ▊1517 ▗0e19 ▊0322 ▕101f
  ▝1f0b ▝0b1d ▚020e ▃0413 ▁0a18 ▀1f16 ▅181e ▅161a ▅1316 ▁0814 ▃0314 ▚0e02 ▘0b1c ▘1d0b
  ' 0000' ▅0110 ▃031a ▔0215 ▅1b03 ▅190a ▔1423 ▔0e18 ▅150a ▅1a03 ▔0213 ▃0319 ▘1202 ' 0000'
  ' 0000' ' 0000' ' 0000' ▅0e01 ▅1902 ▅220f ▁1e25 ▌1e18 ▅170e ▅1502 ▅1001 ' 0000' ' 0000' ' 0000'
)
VOCO_UI_IMAGE_SIZE=(331 496)
VOCO_UI_IMAGE_MIC=(39 48 252 400)
VOCO_UI_IMAGE_PNG='iVBORw0KGgoAAAANSUhEUgAAAUsAAAHwCAMAAAAYZL0aAAAAeFBMVEURExgUFRgbGx4kIyMpKCgvLS0zMTE2NDQ5Nzc7OTk9OzxHREdUUFFgXF5rZ2h1cXJ/e3yIhISOi4uUkJGZlpaem5ukoaGqp6exrq22s7O8ubjAvb3EwcHIxsXNysrSz8/W09Pa19fe3Nvi4ODn5eTs6ury8PD39vXMj/aTAAAxQElEQVR42u19aWPjOHbtPQAl2XJVTWde/v8/zORlumxLIoGTD9wAECBBipTlCjHT3VW2FvLw7qvIfvazn/3sZz/72c9+9rOf/exnP/vZz372s5/97Gc/+9nPfvazn/3sZz/72c9+9rOf/exnP/vZz372s5/97Gc/+9nPfvazn/3sZz/72c9+9rOf/eznTzh4+BcC+iRA/+VKBCLKuR6MXRkpEKGIWBFQxIqw/mH9YyHFXi35J2MJddLF6aTVJl/qQ0d7LW/mYu2fiCWK08vrASJ4xHfWwNJcL7eL5Z+FpX59fT00X4fNv5YdmCK8fl4/7Z+DZfHjx7GRgQBCdtwCSwiEZP1N9vr3h/kjsMTh7R9KIDWMUisO+lSEDDGIiVfS/R0ErR6iiLD893v1/bE8/PilRSBQjRZeoF8jGE5+CNA8u4Y+y3//Nt8bS/XjV6FEoNDd1CQSyAOMsWun+wkQNE/QUsjL3+/8xli+/OMFgGhRFNtzNvOuiZkWUM3O4PATIAIoAcWSYn//t/muWOLnX0oEhSgr1r1/5l0Uc43JkduCiEALKIYit/+/JWnqDbX3f/xDiagDQEuZp70xxy6fBNNSaumpz1LyG2J5+ucrIIUWqY1lnwVbxTAGBVaAsvkj2aiil+Jqvx2Wb/9xFKijAu3g/nmfbOFMwvbQPB5vWwnNreTl219apCga9nYBsLaq4aWo4hDVy7xVHLk6qEK39qMP8q3q4ieu119TORSEhnL77/dvheXbX1rkUEgApakqQ0f3qtMhYsvcLqb22lMXB33UESxvn2xkB2rEiyD4pGswq//aBsxiOyiPWrwwjS1LIyK0tKxdH2ji0HvP0kFpTCVAG0ZjE6KT2kgVpbR9QwRKa40VJRAoKNhK6UPh0otRCtqw+H/y/m2wPP+jhtI4VpC5ViStNTfTOYQiJymUdJ4QISLl1VyuUzzzIj9VIPbszV6uvfMo+qS0qYqDe4eWugbTfn4T3VP8dQygFF4+LW318Xmrf9jCZKw++CKHpfm8TOhxYUV1DAizun1evYhedbtSaI1Wrs2qAIo6bBE62gBL/c8T5KjFiRve3o21t/ebrf1kpQAopSBi1YsPmTWXC5VqXuQe5fyEVl6UD2bzvv6dImLKK2ikcJ5LDWahP/kNeBw/XkQOHpSfN9ryXQhRA7PyUp5Az9f5pIpbn87PlP348ao82rKfVIATHqWQwg85m+qsepK2Ctrw7fY/fH4szz9FlBay9ZDNp2H1bkQUgMZ3lu4/lVGeGa8qWxNVq1w8S7HJ9UDA8k18LC2AIO5GofBDv/J86F5Mq6AM/qp+Pz2W+hcEx9pCB0Wk/CBvH6zDwHCCOBQBKdYnQRiR7oWDWBCki2IE75NODsP1BUCR0li+vuhWV5FQtOqva/nsWP46iBxbZweU2yfNe1VH3fKNWYxav2D8l63GcpxxAlT2d2X40ogEwipo8viP/+JzY/n2U6TQPdfePln9W0Qp6UxEL1yGZb4D4kAi8MTZ/NRerlY6MMVq0UZ+Xf9+aizVmwgOvcVYXaSFEn64MY0dQqQwcMLB8XgI3K+CKLH8t8iLtm1+UkNZ/Fw5C6RWJsuT4NDfuPmsoQzgaRI/eVzf+jyYflXswQAQKC389++yNw+sKJHTDzwxlsVZKLojS/PB6u9af0dZGWOisj0uLNE/h7pnADsE0JC/3w2ckL0S/CyeGMvzUeQgrfnBT2P/JrSKSbcEIaFJ+yJXTIrrqSdFKaDE/v0323SaGIHI8YynxVKfBUp1llxp5NM2VIlZIao0Q6fYuA8yxxkASsnt90cbMaEQSmRdwlwVy/MBckDL4bzyeqmtyk7mebyZjS9ygI36SuhkM5SSj79vHZiWgBzOz4olXkWg62iPiFzFvosgrB9ypCAmybN5sUNvcCs/RtUXnGq6Jivy+901PpXgDU+K5evBtbGMkZvPrUiSVAJFX4x6ryfj6h2Rd7RPA+DHtTOvLCFyentSLI81WTY3dLXlZ1NkkMGfnr0tszg9DmWczC/vXoRE8IKnxFKfxIldVJQrxzxHzEYr+7aRcovAy1XacGZtYxZPieWrRhcOhdykvACTNrZjZgPTajy0Jwc+ZCAb3JcDNWF6j6U4PSOWKKDQxc8ocqVDIECO4xKRmBOKP9Q2U+RaE2ZbtKVEHfCEWKojpMeygvn0HOOU/4w4pBhl3oXlsIDC5cI+7gzBi35CLF+0S3rEtTFZMOGuRDU6ktyOtDE5agl0b776ZV3H0xNiqZWIau10Sylb628MyWniItMaCDEHH65AicjgsmpZXEgRVTwfltCuuDKwl2mgkGHJYOwncGJBiYid52CKgJ8l+twSBAWeDktViEifuuFNAs2Dkbr/MZbFgNWdnyD2u5Tsbfjg5oZRRNZTPqtRuFLihnlRqmEYrf9nGMsFRzMSXvTX+cu4ZY+B7QTIzc8UFdo+G116j5ciZkonz4gNRakZKR88DHuGxGpsX3lMEXV4Ph4PrLvbqMWNe6NtMzoIvGQaINb0H0JpmxKeCUstdYq2+VhjOMvtk9G45LQWmvFVN+NT7WoG5lryMqjxawqnxjWKEJxw1/08G6OidBJJ/30UgzxO+Eq6dDWCzWt8DPM+mMH0c17p/SrQNau1uq5Gl0h4xn28l5HoRF65NCdJbsLXp0eb3h8pGnwyuoyZOd1NTrVRZIpCjDr1zOzAmrzuJ4i5uTwe2uXZ/Thd0CEPiIGgyOjOCMXnU2I5BhE5B8zUr7HgrfP56ev98TXuEvNVKzADmW07FtUmVJh3e5hPI+PN0RwhPW5Lk9vz+FxiwORbkMGyMXnCBxDrA7CcIal4592xQZL3XMTXx4miBiTW/2S3uD3/3Ry7yqeky/RlIl/ADWOZPs8i5xKSZkMQclp1iJF6BAsDS/TMmHzj8ieMzZS52pAqZeBGLvVPka0sIKNEvYH2/grdk12UEeM7LMTioYPI1Ffitzx2EnfaEdqUUwM+uOpFFltyOBZ+DIkpoSdz5kg4kpvgd6RLjPMkFlt7OZY87qOC5/PH/avFY+4oaTgk5Ol6X1xsRJRRlufIX8E1QIVXt8CIFbWhMipk+4PWAxqLZnKG8Zcr8+DnTbaeyVdsRJWjwdwYFrN1ArLYE722Zowbvk8seIaG6Zy/ea0Uz2S3bRPbQB/ZGD55PuzmJkh+bZZ/fPySS7U5FiPxoOGzhTzycPlr4BDYosBuMoiFb4klsxiRq5NXMj/x7XIUczxuzGdgH7BgMjhT1YVbBD3UI0kwz3iUcKBwtlsqw4DSINi5oY2pHk97aXcu9wnd5WyTWyG6DZbL5iuvzg95IeSnzPckOueYdd3d/PUsswjZ0Scyiyu+AY8zP/E1Y+YOZz3dh/kGagOqZNryYC5ZTwd6cyHAw0z3Ne3LHkwsoC7mhBrAcWs+9tMw1PeH6PF5yK7uwFK2+ZIH+uPIFnocGO3RFyRqF7KMHchmgKrHIrlWrSSX0ObW4aIN64kw8FQwNGZC1t5EmiH+nU8cc+M9l8o5hj7WoC5+g1miIw403ciZN3iRj7FatvXK1erIcRJYAA8BbHPjfCu6xD2v4TzDnI/H6Uv0eCJgiPS4hylI1ojrTKaUn19eYiRmk6uiHLHapShWDCo9cU6XqwoF8cLlE/0mwOxv4xPXBXNWIn9OJo3j5dNc/ui+kd+zlnHJcdeHGd/BdaF7MJZYRRpMiwQ+A0Ws26fLGT4F50GIydT311deF/KMh4Ox3hmPhV9NuZvWWG8gKRaGIPmIS35ofnwhlJyh8BfslOSzY3m3/dwv3iWy8AEwl8ifmS5XzzPUPg8dhTHpmH+hSv96ukTSCoQ485Uni2omlTm2Rv3peHzqZpd1oOGPpstkKTXiKGGyT59ZRQXcThg8HV2O+M2DASa8j8S/ke7hvbcQ7guQybmFM8DdIIH2ZXSZ4jVy2mdMo/+VYfXNfEhM2IaMhHQ5S1dgpozYnuHV6vAtll9BdgOrX8QwQr+uhn9En+4TqAesd51fJi+xGMp1JZ+X2cFGj2/jeRvMuLUFUEK2Kcr+hnqcS+9ksZ7GI9DcMBZM5LeWMvfWljfWxubB/CG9UoujicjJ/ITJWj7CJX+OWDAfof6BjXh7Ux+S2QoCi74FripuSXCQveBALGNTKDehy/EkFoeTTNa6LeZPfuM9T/OhPN6Vjo9Xhy9bE4cJhTJkE2aZZc+I5ebxrWjQjXQD8N5aJhliusk1Fl8JImURYcbkc7oj6nGTYNR2ZBk2bM8YmMpx6REdUoC4Bnwgyzxy1tNdt8LWLhh7IoSD6zDZsbH0UQ8BUeZlARldIsDZRUhRkv4WWDKpGAaZbXLGtEQ6+hhpJ4ZxM/Ih0baVeZyx+2lvnU5bHmfSVfN2Zlsy4cguzmOYZ6DLGakyzp9rn3/zXzGtcRt5GY9KZiKXnKAY61pGrhicqK7md5pVj5inEiurHp36gLTnQ46Hz/AQqtwYy/oOmeV6p9VRt/AjXZfF6fDyA6oN1Gb83d1j1pCG7IZILuKMSGvQ2s1CD+DxeIEVFg+4wbJvfMTZKnfGiR9zhhmNlcnUseFWnRf8AN0zsgKGkuXnDS1TpqXKTKp+yjwkB3pkGM/JTvuSOU+HC9z+5HP5FnQp8RmAUdTH0MyvnJxutuCU3H6mONHoHXLe6xGnpLGWiY0zO1vT5fxVXEwbMByQqP8kOIMyR6RxvZz4iXmc037gXMMmKhiBfCbgI4i02JCVR6qgwCnFmmRT3nlN38PvmXPZdRAOaVd5pHmed+yG43fCcsL+WyJeJcWvT0ORG2GJIIQTSE/PCplbfdZBGVkvx7xP2bKqqNiexxls1YHXmhe8E/lUmS9Dx1/5PXtLvXYnzh0wnYJy1gCSLQ3PYmWijMV1mVHLP3QzifmhkxSA8Wmi36J/fGqTHifeMMNJnDlpBou61r6ax+nnJEenY/EORkj88CvCnFvVDE7fC9KBiBHgg4zZcKtkRp3GVsPq1fYMjjwfM2rNY+AzYnoCcLQqS6ad0mf1e5gEmcufC7JZPLQSvl//+NgAh1Z+DqKQs6vI+zGaCVuTg8eQSBuvPEjrUfHLWTR5b/qf8GTv5gNgtsAyypGYUACDbC5nbeX0ZEokuDQ5AQpPS5erOMAzEr5MEWZClHLDGRFfWmMdcf9y+xuQR66biZEH2uqTC2EcNcSYd4g8b2qGGZG6wifPjzMe98E9TO6p4nq0+NKBHlvFNx6X77lvo2O83ogpv+hL5m48cmYjIhtEc5dbI5YuHyn1RVZZw7P36dJz88bc40TQBtE9W0j/WmIiZaSind+gV2pgkSNQmEO6AL27RFZNC3jHxY190bPQJSNwMvONnFT/mauh/FAIZtLtk9pEWfEHyc15ITe4lGcRed4On9cmisxrWpSu4gx3yFc6M8utVhxXrzYlQa6kPuckjPqZHMxC8gnpEksszpmOfVauhq0hkUH8XBXMDecTMYFm/vB1YJGmiFJlIHzI1Vl8RZuIw+IBOBYR7yvI9YZZczpkwXHne1ly/VFYksRq0/7dV3PCoyRmccjA2LJfMetJK4dDIRBh5VyvRYyNHcIMDeRozQtDjOqAkud+BqkOvxdrvHcIg2JW6xImDn2Ms/kgazfA8tdf2luzDrHV/3x20VXSqjTXDYt9Z5arTYWH4+UenJzb1WOpCsH5L2ebZ63Aqn/9Xh3LX39F+sd+naSo/sXQumAMBmQKS7Zv4tj2KaQg9+tD8mux9X8eTAwN9U/5vTKW6qdIFV6AlQOl+Oe/wpQiBmC2YxvmRWDz5O9yb5AioiwgIvo/tUBJ1XyiuxX053smC+XaRGcdNbkrI9QnERGlUjoAa8e48tbd5zwdCgAFEXlRYmmi33Y4rC4vldjg6q2QYkHdhhIeNqMbqzyVeqKRsq08oAiU+/xR2xCH27pYQimooD6gsv5QCIxREZGZY8EaiS3m/QJUthY8oJACpQckZLIVeTZdKi1BYovFTSit9obyNhhmDQcb8U44smjbKdjAPUj6n0BSUKj5AZX5WEI5RQAQEbEKdBPOyT3j2eN0eq8FcUA5YplO20/RST2tAmvocvheZbbwezD2JbEprNEh65m9FYzA0kPJpLfN/MkGGFgB97VHqoVARn6YN4WR03Qy/TljSC6zCZi+SW5Bl1ORtFVmbdMXCkzG2VzvdM7WzvT4onvHbRX59zj4gWUwthwjdDNzciDc8EO+CTRrAELAIkQY94RQZAM9HglkEZkprdHnPqY1EC+Inr8GlqlIHoggQGiDd1VmC7ocjlCBU1IW8UZC1QHfWorWxLlvnD8CK6rDKVFjrfEWA4/fBqNjabeSl6HmoJclxSwKiabHOC4kI3qCM4XT1OIeemzELeSlb0kHTDjg5gZnTlaYY4zAOINnGTVlRz4DqfHXvl8wI/CeaxOByTnwo3cYDChYY2QIx2xOZlKlY/3SMwbu6JEuZt8CM7jFIS5iFgdmXgeSvDdn1AbXHdpaLGbvZPgLfjaC62+PmWT25Da/RUtit7LVhzW8CycDTxXmE8ugnOMwrfzI1WpUwVnuwvz54Z44ZNKB2CBOtxGWMq71ssNUXPIS3j08g5vCqda7Fq5MApwjEpad2mvESrpnjRqYmP9y16I7DMQEH8aoj9I9zFHtQzmKxTfMVJEVuD6DP1yPD6hnOp0/Mng94/5xV6c+xoz0teEsVniwQ4cBCWcO46ofK9wdPU99+JFIFYnev/nj7tqsVPIxl1wzbMp7xDgTjbr9BE2u9u3F/Zc7JK+cy2PuY0mxLTK5iMixQikztjpsoscRbQadV7c615ydHOiGRNggieZa3FCswEqjdfpr8m1eGToXNe94hbdfbV9y+Vvn+lgTYnstj2IzLLkQJKRvHrO+bWxn4bxdmpyzs+WxuocBqyMvyRrnRDDBb1yX0JDfaf4oeemBOV2qyomaozQZDV0uYPzjs5Dn9HXwMVgGj5auNmKnTz296qZQ879kzEudpWkodJ6CM/bfTmWY1sRy0lIkg74R9l4mh2o2wWJsN3ER4wQe10yxDAX8i6IrcSlNH0V5AjHzxleky5apDX1V0PoS7E09uvZoYnUPXHGBgVNHL4DEwZxqkk3pQJgB799JirCLlzRQGlJErNWP0+MJUUlWHzWnGUOpSFJoeZOfOVVjgPzge1mHzOuGuqv8mH4jgJ/y+9I9QdJW/Jk3IwE/+P5RQ2lJY2hFRPhpHhcnSiRH7cVQRPQblFJStFnCQuTnkEEY2f181MdG5EFA8Mjbz5TSct+pDwdPaBaUH8nYiEfih+OhaWOoqx7Vj99WpPo8HeyDsIxFfSD2UomI6F9HrTUgohtWOkk/2iGcJOBWZTeFvg2Tg5C3H0Nhx6G/StZM1aF8FMArk6PXB1NfMGqDDUfUPE4RVkb924pU1Zvml2DZsmglIqJ+aQzjRIBnlCPbjF8qcIZEz15+c1A1CIjQWgHUz7+tiLwfvxDLXuiCYvumqHGf5kvm3QTuLttHrcT0k1H4BFjWzOVzJQRwig9munmLDGdGokPsFvV5pgCIOmRv7XqduvfZ6rG6/8Y0YQtibadghZhRjhs56EBlb1S6llljPGWMHMWD6NLrmafvh4BCoDP67gdzspPZmT/USUoZ7oYGk7mnL+XxRDynL7dtiRR3gcmsP9KBzV+/G04wIzp/zGdxPB7LyIRAJ7HCdgYY2JYCN/JpJpgjU0N7UnNGYblBlkQRXv1oEYnGyN1L04s7aMRzBuFfHOvq5brmzRWaxKKvCH14xnlaQqocRNoaKIn1J2AW93D18E7p6Z6GHCmu0MweYTuYwMWAJlMYJgMn9TUQ24wSXccmor9kkC1yLW8TdDVQfhwvRGsoBQdjh5kSqp32RhhsXmuB1529UqnoNzu2pq82J9icEUL3RCB9eyeMRo9G8zqiTM8hvwvMTeZm0VGqzlLr1OjqaAjORaqDso0Ktbu6pNfE7OZ+jFoY9+qXjehydOJKZ3VER4mMV7tw+FcONQ2H2lxis0y8a+Xskc4b0iWnzb74K/ON4uBTOTTEZS6UfXR63Br5qlhw+NQ5YCTGtH5uPpFxi8iFkJz7odPPkY/DkqlQgnT9NWPdUPOaGDj8Jma+Y5lIfIK6jWmm4aSq5Aj5cgEsW+mX9bDkZpeJFJRDc4dTXuacenhOWMzbYBlZIT+53KHPGqzsZ3D+iuIMjuZcwbTcJhpr9bx7TUya4xn1D9eXTXdzmVrxItaN3UWjPGmdn/SeHndf6kugW+NgAwrgXTs/1CZkOT1xjXd9Q7zOmrl4bUQ9Sp75pLaUjwWJN7uIjbHM6y7jqgzbdd0lh0SMT2zeLqW8HV3iyxLhiSfMuS7jXBtT3XG95CwawyoPaPpnzPgMrszeq9LlRF3+vUSKfIadDEFxRtfvrPU06i7ouJysOKX5mU2bSyfaMaxsurOHUK1EjP0yUSzn1vyXL1oIwEmSjzlB2BZLMk86R1dyYJy4MNDXSfwQ/Q5kaxFgso5sc3mZDGTAM1NqMYnuX645M6JD4AIJF3zXGnJwDEF3PzyAvb4U1Jc6QDHOUtxyZuPws40FVH/NbOpL3PTjzNz+sHiFo9qDORKizzR3b7M01hpjV2lVW6Vuw76/UQCl4K1aJ0MDGyO8OcDR+Y5w5duIHm669wHpixYlzHI4TSmk0H7YNXj8vroNNtdg3gulZXo4IEYlZqwMiHfSy8SAN4rQsBnLyJkG871Y+lB2X26MPmjXlvnK4t8JUyN4QVl1RGkXKvDl8jJ+DBQQc5zramZIp3+6v0WHmtCrQg1SmkwxfZRMk8q7qRclKTTRuatNV+YDsfS+TKn6GtlKxgY+oPuTuP8bGj1+UQG9+gLG62KYlrHhXzoLALXBQdJaK0UZuR8+Rl4mrYjmGtmbHx16HaIujgMog3orBvVsbnkWQwXERHrNn3XqWkVCsQFbh0jOJcyZvVIhTwXLLQEnSOTTZH8bDpZD5dPX8/XjCtH3O/WF8O6/urpp9rtS3bcGUDb/WDXcz3RXGLRYKsljbn/L5K09koISoTJ3W89b0Lq68rYcti0w7vqj+po5X1E4BZaEHwR0RIwoG9SuD28Rm2AZz0yHwzBVewG+MwIRV0QOorlOT1lbA9vi1/3dKTP2CNVrAUfXTgqvWQ0xMDkdO+CsSVNLcrrxj7eBCMSYqhpa6j4cLvc6QIZzSrvXuXslQvYPjdvmf/XnYsWxsQv88dQqNojvavSc1bfzIWOvMGJBMP+HSEbqmq/CIGbVSxeHzde1gtU9UIbOGyCDGeHMDpNBpkKakrX3HrHXYfB888Oe3ApLZhtJI+7iOJiYoFhE5MXEZyKkcgCyNmHeVcuKdP4lFbIeBXfOnWEqVuaYQsBIRPkLdhNH7EtOUeVkQDv9csyKomNM/GJMBOBL6JKxkebDBA7mk9iEAy3pDMXYG5OTSHLbsb+wboO8A8XniCRF+W39Pt1IZjDD0PXMoDXanudQDDiiwtKSynft8SC6jEcmZE1RhBWxjbLxpDvOr+DxkW9dmL+NT9T0/jt3hSmW3BQej2VtrqcjgdMiAmsSYKb1+oy73KVZwHT3VLSZUnAO8MPKI655repuBs57CWfRzl1UOP02IBXqeqwPmT5V3Gbn/PrxmcWcC8ui6ySHeTxdZhxDjnXBcjZJLd8XkOt7CB0KuFthbaHH4coipshmeb8dl3xIpHAxUUO6eGDRnVgifNAS7TOiO6GOS55PDoFwFg03DzpuYC6CUy1ijsTPOX7Pk7J+Rp88F73Lubq6n59k4iKbwXlzqlnVHUiGAX5TD/RMXNrA20i6HMMxi/dTIgaRkrqWqJoUqRv0UdAZjpWQKGVw3RywNJM4ziCsVRpc24ES5STPrb8fkuHgBg4jg1W9rHjg+rGV8uOtd1yK4nwJX8cPSaGN2J3+sRvQZXgzQzR9W40xfDisvJjHvZxrZo3blz5QKuq00a6Npc3wqC1H7QkOWgaWriNaBKVXA1orHrkG/hBj3GO34fHQF/PffqVvYQbT/jwUOMNUHP01s6yF+JoZn5MAcGhzMts1ysWyZCy9E2hya2rliOFdMSyvCge4MMs1XMDV7I1euPYbyWacucvjdH7dEsHadGlsHMswVMR4KIY+nm7pH32LedLMSYwxmpxBFsglkmTl/VZDRSYBra/HxZrI7jAJmPySEJh0p8RwsLoipVuCHyxayxNPpdd0Z2/ea49AJKJn7dq2Oq0dejmA6ADwbsh3T5QMeXxadzDDjGSGtOxGzgXeePM4g3uCUiqy2WZ9+9IaIPwCAH4smYZJBZ4s8I0r6LF+k9zJREMb2CmupvAWsFkMDLOB32MtBg3bCBW5XFqJ6RNmZxoHhefkKJTTgaWptot0PQNJGziQWkWI0GablzNsdRu5J6UUZKDJxe+TD7icQSX6uNnIiIU6NS/QAZZRh7zV4j5KSukIP9ucCOdMLG+Wg2gUFFRImB3/B7fHQPNwGN1iIPGY3Z/Mib90pYKu6rGfAQ1rPTB/gC3o0hgzFHFKhUxemTCISc886v7ljLMcWpjRPrOIqcMRDk/rjCbWFjajFErBymN43Iga0IdSh+AnVw62cjhSU5wwhzMrlCQTKjwYlj6mlabxFSc4aS/Bzw/FsK2CA/tlFSxNNbQYRKtwhVBp2CXo6XQ8MbDTE1PEwolZObKUETocKiF0QdH60VkTsngsv202sIlk8N3123UoMHkjI4udGYDKbklEYmV7lLw8zcNoNHAkxQCXLHkNXqMOh4Ys3QCHCSOcq2B5MzFy11oPXtcRJjzHxh0c7Gh0Ge7bihs6gWqKT1qOGgd+AW2jxEOMjoWqg2Fexs+I2QBLY8qIuab1KaTfa6/KMSDK4I8eGXE405VT0eIA0WinTESH036GpFsUImbwJI3dYnYJTTV8NZQKmVxulQult6yEnc/Rm0e9+kkoEEaDdOkx4JM1YiRpQnJTRREzJuw2WNoqZtYVOvwIfloJDXYGtEnfbB/TPV7H46hHn96cEDg8pP0YkOXxINXg88qEV3wnllIaJ6zBlsCKAZNLVbEOKiDc8egQpGdmcsiyHnAMjU0mFNMwIOp09DTXbkmWA9F/qlk8vJUZqmcOlpW5Ndva3FZWVRQDKfph2bc+MyBLZ3I9uyJ40jEymQSOuVCS8X2cNVEObUvB4RCdJMJtalmtLSORFHXUh8Erb/RDb34ErglZB9P8PX8lnF3C4TQT+vpmzLGHm2YmyQGHy6lbdBhY6nYTLKWW1wxc/0MxYHL5LHsjE862UseNbOsimmWi/fFjxxKMOEisRInbmhIOTKnhYTkMVxyjLH4Lw3KrYXmtykEpKUUOAxNT+Glq2usEFYPwRpuZ4GC1U5siFHe8QQhuAkpfPCPO5GI+B78ojkdENHZlzUZYWnsTPYyVvhQvQxK+Wj/4lgCzw6gjSrorPLzMRtLn8bd6MJ15ptBa2suQb1+PmlXEDJzD4rOwZBVRalbkeBh+yrVsa64xCBMFnqSnxz0kQyUerk/hwB2Pes99hrlO8pQRoX9CJN1YzmJxmbXd2B50MYwaKF3K8PKqQoXjwfw5ML00Sw1eDIKY8XVwaTPdnQDglGNFOFze3l6lG63Tl5dd7JVbYcmDOg5CfIRYUw6T+9Wxn5vmg+kPghn2y4b7jpj0xlPrALwH5UBpLc1Qh4v+cdZy6+O/raC6VdvRpRTqJXLNhYoRJm2BdnhJ+7Q9MoFLnl7Ac+g8xpCkyBiUIZa1sDSxcWNv57OUtp6F4DzVsrrY7bC0B10gsvyKtoxkSrT2pyK6c0v82U+RJtX4CJ1YDjOYTYQYF/R6J5K9qclyODTgamax+Ews5YCjc91owwK6ihCmVEoH07IcCQkvgIO4uIyZQJEJg9ElUiEb0Fra6zVyUz/Or72D3F9LVZpZLD4XSykOxaD1klCMSEyRSmuHAOs5UBji6VNDYm9hLBDHRCQOEQ6ntbS3S+yWfr4puQ1jxreZLD4XSx4wZHKIOpSIBQHKQnnzdRDcqOOYxCLAjCnq+FKawYphX8XVXnj5GQvE/TifcLNDI+pqrrIplhovKpT1oBYVdxEqrbp6OPiAekOLogmuqJLhSKdpxBrCFJRyfjvrQQVHLS3NpliKOaiDsqEhZzUsY1zOBkx/nk4gOCUxpjKurRkNdQ41uAelpbXlZ0yT6B/n4yD3IxC5VBfZFksWeBlm5AW6KBErcGCpVTd6DAN7ZWTqUzy2NrFZqrUPQygtbfkhcQ4/i6mG9tStLKuNsRRzVHqYkrfQYquoqL4pjX7kLPz4TWI8DhMqOpqniHiMLpSshzN+xoXf29tZySXyIRfzKVtjyUIdJZqQtFLGW1WoW6Z2R2gFSMZH1CV2wqaTOv1DQzOZsfZ2PuNEpn6cjxKxInErq3JzLMUUOEQmHUIfKsS/3lSFcgjGnbI0OgiMaYc7Xj2PdtKm47rSWlrzEVcj6uf5LKaMTAG5mk9ujyULHGN1N0rpFJi21ArOwDdMz36KFwNObL3oqL+Tzaxjvx+JN76d35RcI99flrfZZLkAS6kOMcIUWxRiTdy65a3Obrhoxlg76K+Z2uwagxLOoKw6uWM+Unbi+e3tIJcYzhdz4SOwZIFTdFKD1hYJMKUsNdr59XA7KUd6b7OGoQDtAGB0TN7nI0hbfaTMxMOP8wm3KnIN17KcT5ZLsBRTSBG5UatwrFSZqjO/qc4BAhwDCS4qccQwmGQH9Bi2P+hEZUCUqUdS/OP8Ko3LHVTkXpeQ5SIsCXU4RALYRuNQ6eQDLUvlKByIB0aLFgYTiPvf9O8BhqB2E557QWnt9TPpUqtfr2fhJcYfF/O5ZHTEEizFFCyUjf1ca5MGk7dKdwOFBYlJgYgcCf7b/9H7TZ+PqEsKqo80p6pfr2+Qz9g+r/I21xO/A0sxhSpiItMWhbK6SvKHvVp4ISZPb4wewRDPzr5yCZWNy2ir91uaUdXP85uSIBCEliw/FnWtLptPZMrrKdZXxNvpVUTe07Gq6+140kq6QewRmyamlNireDhaPdJXa5tidPM5FjBTP89nzUuUk6/mumzVxzK6FKPlEONy2uIAM0KZIuZWoUvxDsamtvpYdf+CIypdzykuRiwtSVN93MZIS/86nwsZQgkRmKu5yCOxpNWqiPYsmeKgxsEUW94g6FO1kGhYUzJGTAemvK3bdj6vo0hK8ev1rZCIfoGAF7N0A81CLMUqOaoUmAULM3o9LK9lk4RhP/bAcW6c0IcbBA6imm29XfNfS9Ka68dtvGYSrz9ffqgIVQpEcK2u5UJMFg9WxI/X1yJqTKqTlB/XyySjQJ001CAuHI8Ru0VFTsuQH1KytqwmaUqdX49nxKAUiFSX6n3puITFs/H4oXShTFRZnw4/oPSUMqT5EKWOUBgyN2KbP+JgtkaQrbLqofWP0+kFjKVyIMLrQh1+F12KnN7edLwyHkeRj+vtPU/uAIDWrlZBLOgR6wCo4bSVZe7AwNP5+HISfkY9evBy+6gWA3LHzMZboX6Iii5tuZ7kXEDfsuJWZD1XDyfdWIuMxY2iw4JYlnPISL29FGctVcoUv5bVcigX6x4RkUrLQcdvxShdHIjCzLlTc+j8SCh9KA5FURRaK4Xk0EvOqQbAy8/XlzMkEU6DlLfq8w487pklyneo8yERTLeF+vEJVX3OMDAAsDEvlVJKAa07aC0tKfQXl4Aqf7So6PPL4UWLJLPe1W1BAHgluhQahajJXlugcjgIDvnNRurYmORKa60LrbVWWmkFBVGe4d5m45Rks7h6O59ezho2GQGy1+q+3YZ3YSnWQukEmGKg9FFRH6vM+8UJPVFqpaDqfXQQgPCjaoAACrhlDnx9ezue3o7gLVnWwuuy6NBaWIoRSYNprUZxAA6HvIYjnGplXjO4hgoXefSBjHZpGbLkpXp9Ox3PL5ojVS28mEspX4mlVGCRFlqGovUJOBQ5vR04qYbelFI1TQJtW0trkMMJrilIBpb6fH45vp41eE0raV7M5XYnFnfPsf4QnLVOMYexhH45XcvClBnRF7RbgKQDrN7+RPg7u4SSuaC3eDkUxfEoIrfKqShkMPP0Yi5X+Wos5UNkBEwaESnwcr3po7lWE7Oue88niAfVYLb4Ncu6ZHIbmX4ptD4cDzWSoVsKV1beD+Ua89U/RF6ORZUEqIRIoV5vZXW01XWyk6tLWvg/9dYbZm3S1aeigD4cFRokg8/rpbC9Vtf7oVxlVv2HUE6HNM2xhCg5Hu2tLE7GmlscT+jhlANICB58JxJRxQetj1orFMeDwPJmRpxniLlV18sKOKyzIeb15XySUQaGKgQipiwrS0vL0gRDQTTO9bgjAEpp3U5MYFMQROu0qjWBZFLeg3GgCkVRK6+iOAhEqtKO752qbmsw+GpYysvry1EmBvKhbmhhVVW2DTtaIcVSKIcCTbdRbRfpov0L2wxOv7OY7XQxKyI3KxAoNxGkdFFooQhLM9AzoYdWmY9yFRBW2kdxqciTqPEAcFVBa5HiIGKNNdb2A7WEggLwY8IQhquru5f008R46mq4UYectIaYJn6UuJT+Q2+VeV9p9v9qW6D02+mkMwYcAkqLWIFqin2cNtN6OmmT5Ua3hbQd8dv8rNllT9u0TWqHHhWEVhTEGOvXY3u7YrsnZEtTvduVIFhv//hva08nmQwMkdaItLvKoXvX5tbY3YDSTqVazeGJj1IozgjHQCboMdacUJnycy0oV9w5Y98teVA2a9y36SvSHFevEkJUvcm8X+1FEdC2bfQ9EVNErDuhglKlB6JzyOXWmOp2ecb9PcKP29vppHPjQvQ3WLBhvVotq74FrIdwCKWQ9oKJTTVMSEpjbLWS1lnHH/dJsxQrUAuftLW2UcVKlN9I6eXJ4C4FUArRDRjjGgIiLI25vRt5ViyFt0pE6YXLITss2xilBGBy2CmgFDBTg6K2hKz5vKy7AGtdLBvSXAbmOJbhOi10trkgc8twXypvbtaWq/L3yvKyVUGVNcc5uYMsGFx3/C4LkEJbWTGf5epb2VbHUni5navDEViybGMaSYgQ7Ha6M9Qow68NfsLSkitaQltiKWJ/F6/V4XgvFSFFlgGRQkbWoRL++hqWhqw+zQa3vQmWItXv46k6HOaiiWSAeBBuQ+7mGbpZDlYVWV2rbZYuboOl8FoeT2VxAIi1L3wshjm6tcpWljSXaqv1lRthKWIvt+OxLA7LrE2kMGQbVc8UumDL/1VlKRsiuSGWIvZyLV7LQh/y9m1lMDuTGgZJqqx/Y01F0lwq2fAUW344y7J40WWhiyw4l8asMMHg1hgrtHPHFDwXliJS/VbHQ1GoYsopSIpVZOSHkIbSWmNJa69mYyS3x1LEXq7qRRe6HnmNtTcXp4uxWTeWkrYqy82BfAiWIjTvUKeirg7qLMIU/SGqT2o7nSOuYfCY2sCSMbfqEUA+CEtpaoAPB6206ndYOAluf1wB8li9qzvoBCb6/UoUa81DWPvRWIqI2OsV6lDUZVdQYUDCVmXmoD5vREQpGuFoPVoaa21ZkfLAUzzyy4TGNDnGrnnH+Z1YNamZetyaPxkx6OVGHS+2tpwzf/p7YlnTjq2uddZQa7eSTTVNFbPiH+zG4VCEtqKQ8ngYvwjLnhv7Ab36pNqcRGS3dYxIXfFJc7PyBEc9w0WIuVG6fb3INOabyK4CnwPKJ8FSiqbLJ8cBCrpVAA3ZsXQuQ00x9rBHui1OUNix9O1tNyM+qXs8XPEk9/AsWPr5L0T7yJEiadnpMuRgJFshxW00R4Sgn0ToP8dlMGDb4WzR0I9k741j5/EYj2fqH0ZCGzuWOUbQOFzOku7/yzzeQfByH3Ed3RUn/L+AZTugtdl16itrN13JeLo7HnSjpcjxGLyQzQQycZfX/hFYojiq9KoEEREtpIBi61142qq+l6cpArZ0lr97+xWobYTY3Q1h1UO8zEdImrcfEFpv7aJv5jTA1FN0VE2/Cs6GL1raNjLZL0ljsxTbxm7DaRNSSuTv9z+CLt9+aK8I2JvujbpRwjZ/gRtrD0c0AiK67QdoGyxEmkptafcFtUjSrZ7/Ke9/AJbqLaAX5Zk2EJKiWxrr5pH5crFbdE5vgBkZrloJajYpbUz4xwe/P5YQVrTtuIJwCp4AHaGm89xBgZWz3q9dk5gGipYEBPgDsKxVKcm26RsQRBI+auDrcI6F0+1Q62ab9eXuD9ILj8pDNs3fbNsiABtMaRt7s3VGbNFb9xVMXW/3hbBNT7a9Ao/wNB9uqxNN7rXPeHd3Tq8Aw2HhVs94K75i63zqLkkQ0vx/4Oz/YT4kxxzC+IZ2+himoAw+/bEp3QdgidRfkWvkjqxM4OjP4ZI5/ki6xJLfcXLk/5d7JY/BMh66QJxqgSmpwDGA4PE45XFBJPWlVJhy/LIkLfKlMf8QLIdkyIVQcwEueCCeD8KSaWJdHrpE7rf9UVgyzsLIFgfdByC50mu2/fUNsaQM7ZNlN44cS0u+DtWvyvcMxq5ijGDT8cmc73mUyf4YukwXEmCBmg8/KmFbyaMz59tjaSv6onKw3BlrWNNDnN3ePWvLP4HHeTGktx7Xmw/BKRsK7WKvfv1cOM1+RGe1gyXM+/ZYPiBO9CFF3+rQhNmIiCLhcHBGv/e9D3FwsElusKu4jRD3Ibrqsv2N4jGCBKodURsswoSTCnL/3V5cH6lsw289hYcbJOn57mzH8XSDjP4ILIeuOZqxbaFkm76c2A60HmbSSmxX7JfHbL70OHOuuuUy+MKijP3sZz/72c9+9rOf/exnP/vZz372s5/97Gc/+9nPfvazn/3sZz/72c9+9rOf/exnP/vZz372s5/97Gc/+9nPfvazn/3sZz/72c9+9rOf/exnP/t58vO/i5ov2SkS4M4AAAAASUVORK5CYII='
# END GENERATED INSTALLER BRAND

voco_ui_configure() {
  local columns="${VOCO_TERMINAL_COLUMNS:-80}" rows="${VOCO_TERMINAL_ROWS:-24}"
  if [[ "${VOCO_INSTALL_PLAIN:-0}" == 1 || ! "$columns" =~ ^[0-9]+$ || "$columns" -lt 64 || ! "$rows" =~ ^[0-9]+$ || "$rows" -lt 12 ]]; then
    VOCO_TERMINAL_MOTION=false
    DIM='' GREEN='' YELLOW='' RED='' NC=''
  fi
  if [[ "${VOCO_INSTALL_NO_MOTION:-0}" == 1 ]]; then
    VOCO_UI_NO_MOTION=true
  elif [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
    if [[ "$(gsettings get org.gnome.desktop.interface enable-animations 2>/dev/null)" == false ]]; then
      VOCO_UI_NO_MOTION=true
    fi
  fi
  VOCO_UI_LINES=10
  VOCO_UI_ART=false
  # The card needs 24-bit colour and room for its 21 lines; other terminals keep
  # the compact canvas, which names VOCO in one line.
  if [[ "$VOCO_TERMINAL_MOTION" == true && "$rows" -ge 23 && "${COLORTERM:-}" =~ ^(truecolor|24bit)$ ]]; then
    VOCO_UI_ART=true
    VOCO_UI_LINES=$((VOCO_UI_CARD_ROWS + 2 + VOCO_UI_PROGRESS_LINES))
    voco_ui_art_mode "$columns" "$rows"
    voco_ui_art_build
  fi
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
}

voco_ui_now_ms() {
  VOCO_UI_NOW=$(( ${EPOCHREALTIME/./} / 1000 ))
}

# How the card shows the microphone. A terminal that answers the kitty graphics
# query gets the image, any other a mosaic of the symbols it draws itself.
voco_ui_art_mode() {
  [[ -z "$VOCO_UI_MIC_MODE" ]] || return 0
  case "${VOCO_INSTALL_ART:-}" in
    kitty|octant|sextant|quadrant) VOCO_UI_MIC_MODE=$VOCO_INSTALL_ART ;;
    text) voco_ui_mosaic ;;
    *)
      # Over SSH an answer can arrive after the probe stops waiting and reach a
      # later prompt, so only a local terminal is asked.
      [[ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]] || voco_ui_probe "$1" "$2"
      if [[ "$VOCO_UI_GRAPHICS" == kitty ]]; then VOCO_UI_MIC_MODE=kitty; else voco_ui_mosaic; fi
      ;;
  esac
}

# Ask the terminal whether it shows kitty images and how big its cells are. It
# answers DA1 last, and every terminal answers DA1, so the probe ends once the
# answers are in, or after VOCO_UI_PROBE_MS. Echo stays off meanwhile, so no
# answer reaches the screen, and the terminal gets its own settings back.
voco_ui_probe() {
  local columns="$1" rows="$2" pid=$BASHPID process tty saved reply='' char remaining wait deadline
  local -a stat
  local kitty=$'\e_G[^;\e]*i='"$VOCO_UI_IMAGE_ID"$'[^;\e]*;OK\e' da1=$'\e\\[\\?[0-9;]*c'
  local cell=$'\e\\[6;([0-9]+);([0-9]+)t' area=$'\e\\[4;([0-9]+);([0-9]+)t'
  # The whole probe, its setup and restore included, takes at most
  # VOCO_UI_PROBE_MS; the restore needs about 2 of them.
  voco_ui_now_ms
  deadline=$((VOCO_UI_NOW + VOCO_UI_PROBE_MS - 5))
  # Only the foreground job may use the terminal: a background one would stop.
  # The process group and the terminal's foreground group follow the command name.
  { read -r process < "/proc/$pid/stat"; } 2>/dev/null || return 0
  read -r -a stat <<< "${process##*) }"
  [[ -n "${stat[5]:-}" && "${stat[2]}" == "${stat[5]}" ]] || return 0
  { exec {tty}<> /dev/tty; } 2>/dev/null || return 0
  if saved=$(stty -g <&"$tty" 2>/dev/null); then
    VOCO_UI_PROBE_TTY=$saved
    trap '' TTIN TTOU
    stty -echo -icanon min 1 time 0 <&"$tty" 2>/dev/null || true
    printf '\033_Gi=%d,s=1,v=1,a=q,t=d,f=24;AAAA\033\\\033[16t\033[14t\033[c' "$VOCO_UI_IMAGE_ID" >&"$tty" || true
    # Each read runs to a "c", which ends DA1, so an answer takes one or two reads.
    while voco_ui_now_ms; remaining=$((deadline - VOCO_UI_NOW)); (( remaining > 0 )); do
      printf -v wait '%d.%03d' $((remaining / 1000)) $((remaining % 1000))
      if IFS= read -r -d c -t "$wait" char <&"$tty"; then reply+=${char}c; else reply+=$char; break; fi
      [[ ! "$reply" =~ $da1 ]] || break
    done
    stty "$saved" <&"$tty" 2>/dev/null || true
    VOCO_UI_PROBE_TTY=''
    trap - TTIN TTOU
  fi
  exec {tty}>&-
  [[ ! "$reply" =~ $kitty ]] || VOCO_UI_GRAPHICS=kitty
  if [[ "$reply" =~ $cell ]]; then
    VOCO_UI_CELL_HEIGHT=${BASH_REMATCH[1]} VOCO_UI_CELL_WIDTH=${BASH_REMATCH[2]}
  elif [[ "$reply" =~ $area ]]; then
    VOCO_UI_CELL_HEIGHT=$((BASH_REMATCH[1] / rows)) VOCO_UI_CELL_WIDTH=$((BASH_REMATCH[2] / columns))
  fi
}

# The mosaic for a terminal that shows no images: octants or sextants where the
# terminal draws them itself, so its font can't lack them, otherwise quadrants,
# which every terminal font has. Inside tmux or screen the terminal is unknown.
voco_ui_mosaic() {
  local vte="${VTE_VERSION:-0}"
  [[ "$vte" =~ ^[0-9]+$ ]] || vte=0
  VOCO_UI_MIC_MODE=quadrant
  case "${TMUX:-}${STY:-}:${TERM:-}" in
    ?*:*|:screen*|:tmux*) return 0 ;;
  esac
  if (( vte >= 7800 )); then
    VOCO_UI_MIC_MODE=octant
  elif (( vte >= 6400 )); then
    VOCO_UI_MIC_MODE=sextant
  else
    case "${TERM_PROGRAM:-}:${TERM:-}" in
      ghostty:*|WezTerm:*|*:xterm-kitty|*:foot|*:foot-extra) VOCO_UI_MIC_MODE=sextant ;;
    esac
  fi
}

# The image goes to the terminal once. The card then places it over the
# microphone's cells, cropped to the shape of the terminal's cells around the
# microphone, so it fills them without stretching. Cells of unknown size are
# taken to be twice as tall as they are wide.
voco_ui_image_build() {
  local cw=$VOCO_UI_CELL_WIDTH ch=$VOCO_UI_CELL_HEIGHT width=${VOCO_UI_IMAGE_SIZE[0]} height=${VOCO_UI_IMAGE_SIZE[1]}
  local left=${VOCO_UI_IMAGE_MIC[0]} top=${VOCO_UI_IMAGE_MIC[1]} mw=${VOCO_UI_IMAGE_MIC[2]} mh=${VOCO_UI_IMAGE_MIC[3]}
  local w h x y k i=0 data=$VOCO_UI_IMAGE_PNG keys send=''
  (( cw > 0 && ch > 0 )) || { cw=1; ch=2; }
  # The microphone cells are 14 cell widths by 11 cell heights.
  if (( mw * 11 * ch >= mh * 14 * cw )); then
    w=$mw h=$(( (mw * 11 * ch + 7 * cw) / (14 * cw) ))
  else
    h=$mh w=$(( (mh * 14 * cw + 11 * ch / 2) / (11 * ch) ))
  fi
  (( w <= width )) || w=$width
  (( h <= height )) || h=$height
  x=$(( left + mw / 2 - w / 2 )) y=$(( top + mh / 2 - h / 2 ))
  (( x >= 0 )) || x=0
  (( x <= width - w )) || x=$((width - w))
  (( y >= 0 )) || y=0
  (( y <= height - h )) || y=$((height - h))
  # From just after the card, up to its first row and the microphone's column.
  # The cursor is saved around it, in case a terminal moves it anyway.
  VOCO_UI_PLACE=('')
  for ((k=1; k<=14; k++)); do
    VOCO_UI_PLACE+=($'\e7\e[12A\e[5G\e_Ga=p,i='"$VOCO_UI_IMAGE_ID,p=1,x=$x,y=$y,w=$(( (w * k + 7) / 14 )),h=$h,c=$k,r=11,C=1,q=2"$'\e\\\e8')
  done
  VOCO_UI_UNPLACE=$'\e_Ga=d,d=i,i='"$VOCO_UI_IMAGE_ID"$',p=1,q=2\e\\'
  # In chunks of at most 4096 bytes, as the protocol asks; q=2 keeps the
  # terminal from answering.
  keys="a=t,t=d,f=100,i=$VOCO_UI_IMAGE_ID,q=2,"
  while (( i < ${#data} )); do
    send+=$'\e_G'"${keys}m=$(( i + 4096 < ${#data} ? 1 : 0 ));${data:i:4096}"$'\e\\'
    keys='q=2,'
    i=$((i + 4096))
  done
  printf '%s' "$send"
}

# The card's pieces, built once from the generated brand data. A line has an SGR
# sequence only where its colour changes, which keeps frames small, and each row
# splits after the microphone, at card column 16, into a left and a right part
# that each start with their colour: a frame can redraw the right part alone,
# leaving the microphone and any image over it untouched.
voco_ui_art_build() {
  [[ "$VOCO_UI_ART_BUILT" != true ]] || return 0
  local r x cell glyph sgr last line
  local -a sgrs=() chars=()
  declare -gA VOCO_UI_RUNS_SEEN=()
  VOCO_UI_GRAPHITE=$'\e[48;2;'"$VOCO_UI_CARD"'m'
  VOCO_UI_EDGE=$'\e[38;2;'"$VOCO_UI_CARD"';49m'
  printf -v VOCO_UI_SPACES '%58s' ''
  VOCO_UI_ZEROS=${VOCO_UI_SPACES// /0} VOCO_UI_TEES=${VOCO_UI_SPACES// /t}
  if [[ "$VOCO_UI_MIC_MODE" == octant || "$VOCO_UI_MIC_MODE" == sextant || "$VOCO_UI_MIC_MODE" == quadrant ]]; then
    # Each cell: its symbol, then its foreground and background palette indices.
    local -n mosaic="VOCO_UI_MOSAIC_${VOCO_UI_MIC_MODE^^}"
    for cell in "${mosaic[@]}"; do
      glyph=${cell%????} sgr=${VOCO_UI_PALETTE[16#${cell: -2}]}
      if [[ "$glyph" == ' ' ]]; then sgrs+=($'\e[48;2;'"$sgr"'m')
      else sgrs+=($'\e[38;2;'"${VOCO_UI_PALETTE[16#${cell: -4:2}]}"';48;2;'"$sgr"'m'); fi
      chars+=("$glyph")
    done
  else
    # Graphite, under the image the card places over these cells.
    for ((x=0; x<VOCO_UI_CARD_ROWS*14; x++)); do sgrs+=("$VOCO_UI_GRAPHITE") chars+=(' '); done
    [[ "$VOCO_UI_MIC_MODE" != kitty ]] || voco_ui_image_build
  fi
  # Each row's left part, two graphite cells and the microphone's fourteen, and
  # every shorter one the sweep shows on its way across.
  VOCO_UI_LEFT=() VOCO_UI_LEFT_CUT=()
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    line=$VOCO_UI_GRAPHITE' ' last=$VOCO_UI_GRAPHITE
    VOCO_UI_LEFT_CUT+=('' "$line" "$line ")
    line+=' '
    for ((x=0; x<14; x++)); do
      sgr=${sgrs[r*14+x]}
      [[ "$sgr" == "$last" ]] || line+=$sgr
      last=$sgr line+=${chars[r*14+x]}
      VOCO_UI_LEFT_CUT+=("$line")
    done
    VOCO_UI_LEFT+=("$line")
  done
  # Rounded edges: the card begins and ends half a cell in, on any background.
  VOCO_UI_TOP_CHARS=(▗) VOCO_UI_BOTTOM_CHARS=(▝)
  for ((x=2; x<VOCO_UI_CARD_WIDTH; x++)); do VOCO_UI_TOP_CHARS+=(▄) VOCO_UI_BOTTOM_CHARS+=(▀); done
  VOCO_UI_TOP_CHARS+=(▖) VOCO_UI_BOTTOM_CHARS+=(▘)
  printf -v VOCO_UI_EDGE_TOP '%s' "$VOCO_UI_EDGE" "${VOCO_UI_TOP_CHARS[@]}"
  printf -v VOCO_UI_EDGE_BOTTOM '%s' "$VOCO_UI_EDGE" "${VOCO_UI_BOTTOM_CHARS[@]}"
  # The wordmark rows' colours, the shine's, and each letter's row as lit (1)
  # and empty (0) cells; the tagline's lines, when they start and their colours.
  VOCO_UI_WM_LIT=() VOCO_UI_WM_PATTERN=()
  for ((r=0; r<5; r++)); do
    VOCO_UI_WM_LIT+=($'\e[38;2;'"${VOCO_UI_WORDMARK[2*r]}"';48;2;'"${VOCO_UI_WORDMARK[2*r+1]}"'m')
  done
  VOCO_UI_WM_GLOW=$'\e[38;2;'"${VOCO_UI_WORDMARK_SHINE[0]}"';48;2;'"${VOCO_UI_WORDMARK_SHINE[1]}"'m'
  for glyph in "${VOCO_UI_GLYPHS[@]}"; do
    glyph=${glyph//█/1}
    VOCO_UI_WM_PATTERN+=("${glyph// /0}")
  done
  VOCO_UI_TAGLINE=("$VOCO_UI_BRAND_LINE" "$VOCO_UI_TODAY_LINE") VOCO_UI_TAGLINE_AT=("$VOCO_UI_BRAND_AT" "$VOCO_UI_TODAY_AT")
  VOCO_UI_TAGLINE_SGR=()
  for sgr in "$VOCO_UI_TEXT_BRAND" "$VOCO_UI_TEXT_TODAY" "$VOCO_UI_TEXT_VERSION"; do
    VOCO_UI_TAGLINE_SGR+=($'\e[38;2;'"$sgr"';48;2;'"$VOCO_UI_CARD"'m')
  done
  VOCO_UI_SWEEP_GLOW=$'\e[48;2;'"${VOCO_UI_SWEEP[0]}"'m '
  VOCO_UI_SWEEP_BAR=$'\e[48;2;'"${VOCO_UI_SWEEP[1]}"'m '
  VOCO_UI_SWEEP_TOP=$'\e[38;2;'"${VOCO_UI_SWEEP[1]}"';49m▄'
  VOCO_UI_SWEEP_BOTTOM=$'\e[38;2;'"${VOCO_UI_SWEEP[1]}"';49m▀'
  VOCO_UI_ART_BUILT=true
}

# A row's right part in VOCO_UI_RIGHT, from KINDS, a character for each cell from
# card column 16: 0 graphite, 1 a letter cell in the row's colour LIT, 2 a letter
# cell the shine lights, t a cell of TEXT, aligned to KINDS, in TEXT_SGR. Each run
# of one kind takes one SGR.
voco_ui_runs() {
  local kinds="$1" text="$2" text_sgr="$3" lit="$4" kind run n at=0 out='' key="$1|$2|$3|$4"
  # Most rows repeat from one frame to the next.
  if [[ -n "${VOCO_UI_RUNS_SEEN[$key]+set}" ]]; then VOCO_UI_RIGHT=${VOCO_UI_RUNS_SEEN[$key]}; return; fi
  while [[ -n "$kinds" ]]; do
    kind=${kinds:0:1}
    run=${kinds%%[!$kind]*}
    n=${#run}
    case $kind in
      0) out+=$VOCO_UI_GRAPHITE${VOCO_UI_SPACES:0:n} ;;
      t) out+=$text_sgr${text:at:n} ;;
      *)
        run=${VOCO_UI_SPACES:0:n}
        if [[ "$kind" == 1 ]]; then out+=$lit; else out+=$VOCO_UI_WM_GLOW; fi
        out+=${run// /▀}
        ;;
    esac
    at=$((at + n)) kinds=${kinds:n}
  done
  VOCO_UI_RIGHT=$out VOCO_UI_RUNS_SEEN[$key]=$out
}

# The card T milliseconds into the intro, with the shine S milliseconds in, or
# none when S is negative: VOCO_UI_CARD_TOP and _BOTTOM, the rows' _LEFT and
# _RIGHT parts, the sweep's position and how many microphone columns it revealed.
voco_ui_card_at() {
  local t="$1" s="$2" IFS=
  local W=$VOCO_UI_CARD_WIDTH R=$VOCO_UI_ART_RIGHT sweep=$VOCO_UI_CARD_WIDTH band=-100 cut glow=''
  local r gr i start p offset at kinds text sgr lit count seg label="v${VERSION:-}" n
  (( t >= VOCO_UI_SWEEP_MS )) || sweep=$(( t * (W + 1) / VOCO_UI_SWEEP_MS ))
  # The shine is a slanted band, three columns wide, crossing the wordmark.
  (( s < 0 )) || band=$(( -8 + s * 51 / VOCO_UI_SHINE_MS ))
  # Before the sweep's glow and bar, it shows CUT cells of each row.
  cut=$((sweep - 1))
  (( sweep < 1 )) || glow=$VOCO_UI_SWEEP_GLOW
  if (( sweep >= W )); then
    VOCO_UI_CARD_TOP=$VOCO_UI_EDGE_TOP VOCO_UI_CARD_BOTTOM=$VOCO_UI_EDGE_BOTTOM
  elif (( sweep > 0 )); then
    VOCO_UI_CARD_TOP=$VOCO_UI_EDGE"${VOCO_UI_TOP_CHARS[*]:0:sweep}"$VOCO_UI_SWEEP_TOP
    VOCO_UI_CARD_BOTTOM=$VOCO_UI_EDGE"${VOCO_UI_BOTTOM_CHARS[*]:0:sweep}"$VOCO_UI_SWEEP_BOTTOM
  else
    VOCO_UI_CARD_TOP=$VOCO_UI_SWEEP_TOP VOCO_UI_CARD_BOTTOM=$VOCO_UI_SWEEP_BOTTOM
  fi
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    kinds=${VOCO_UI_ZEROS:0:42} text='' sgr='' lit=''
    if (( r == 0 && t >= VOCO_UI_VERSION_AT )); then
      n=${#label} at=$((R + 37 - ${#label} - 16))
      kinds=${VOCO_UI_ZEROS:0:at}${VOCO_UI_TEES:0:n}${VOCO_UI_ZEROS:0:42-at-n}
      text=${VOCO_UI_SPACES:0:at}$label sgr=${VOCO_UI_TAGLINE_SGR[2]}
    elif (( r >= 2 && r <= 6 )); then
      gr=$((r - 2)) lit=${VOCO_UI_WM_LIT[r-2]}
      for ((i=0; i<4; i++)); do
        start=$((VOCO_UI_GLIDE_AT + i * VOCO_UI_GLIDE_STEP))
        (( t >= start )) || continue
        p=$(( (t - start) * 20 / VOCO_UI_GLIDE_MS )); (( p <= 20 )) || p=20
        offset=$(( VOCO_UI_GLIDE_COLUMNS * (1000 - VOCO_UI_EASE[p]) / 1000 ))
        at=$((R + i * 9 + offset - 16))
        (( at < 40 )) || continue
        kinds=${kinds:0:at}${VOCO_UI_WM_PATTERN[gr*4+i]}${kinds:at+8}
      done
      # Cells from W - 2 on are the card's padding, never a letter.
      kinds=${kinds:0:40}00
      VOCO_UI_CARD_KINDS[gr]=$kinds
      if (( band > -100 )); then
        at=$((band + 7 - gr)) count=3
        if (( at < 0 )); then count=$((3 + at)) at=0; fi
        if (( count > 0 && at < 42 )); then
          seg=${kinds:at:count}
          kinds=${kinds:0:at}${seg//1/2}${kinds:at+count}
        fi
      fi
    elif (( (r == 8 || r == 9) && t > VOCO_UI_TAGLINE_AT[r-8] )); then
      # Typed in, a character every 10 ms.
      text=${VOCO_UI_TAGLINE[r-8]} count=$(( (t - VOCO_UI_TAGLINE_AT[r-8]) / 10 ))
      (( count <= ${#text} )) || count=${#text}
      kinds=000${VOCO_UI_TEES:0:count}${VOCO_UI_ZEROS:0:39-count} text="   ${text:0:count}" sgr=${VOCO_UI_TAGLINE_SGR[r-8]}
    fi
    if (( sweep >= W )); then
      VOCO_UI_CARD_LEFT[r]=${VOCO_UI_LEFT[r]}
      voco_ui_runs "$kinds" "$text" "$sgr" "$lit"
      VOCO_UI_CARD_RIGHT[r]=$VOCO_UI_RIGHT
    elif (( cut < 16 )); then
      VOCO_UI_CARD_LEFT[r]=${VOCO_UI_LEFT_CUT[r*17+(cut > 0 ? cut : 0)]}$glow$VOCO_UI_SWEEP_BAR
      VOCO_UI_CARD_RIGHT[r]=''
    else
      VOCO_UI_CARD_LEFT[r]=${VOCO_UI_LEFT[r]}
      voco_ui_runs "${kinds:0:cut-16}" "$text" "$sgr" "$lit"
      VOCO_UI_CARD_RIGHT[r]=$VOCO_UI_RIGHT$glow$VOCO_UI_SWEEP_BAR
    fi
  done
  # The image covers the microphone cells the sweep has passed.
  VOCO_UI_CARD_SWEEP=$sweep VOCO_UI_CARD_REVEAL=$(( sweep >= W ? 14 : sweep - 3 ))
  (( VOCO_UI_CARD_REVEAL <= 14 )) || VOCO_UI_CARD_REVEAL=14
  (( VOCO_UI_CARD_REVEAL >= 0 )) || VOCO_UI_CARD_REVEAL=0
}

# The card at rest, and the wordmark rows the APT display's shine draws again:
# the graphite and shine colours, then each row's colour and kinds.
voco_ui_apt_card() {
  local r
  VOCO_UI_APT_CARD='' VOCO_UI_APT_SHINE=''
  [[ "$VOCO_UI_ART" == true ]] || return 0
  voco_ui_card_at "$VOCO_UI_INTRO_MS" -1
  VOCO_UI_APT_CARD=$VOCO_UI_CARD_TOP
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    VOCO_UI_APT_CARD+=$'\n'"${VOCO_UI_CARD_LEFT[r]}"$'\t'"${VOCO_UI_CARD_RIGHT[r]}"
  done
  VOCO_UI_APT_CARD+=$'\n'$VOCO_UI_CARD_BOTTOM
  VOCO_UI_APT_SHINE=$VOCO_UI_GRAPHITE$'\n'$VOCO_UI_WM_GLOW
  for ((r=0; r<5; r++)); do
    VOCO_UI_APT_SHINE+=$'\n'"${VOCO_UI_WM_LIT[r]}"$'\t'"${VOCO_UI_CARD_KINDS[r]}"
  done
}

# The card for now: its final state once the intro and any shine are done,
# built once and kept.
voco_ui_card() {
  local t=$VOCO_UI_INTRO_MS s=-1
  if [[ "$VOCO_UI_NO_MOTION" != true ]]; then
    voco_ui_now_ms
    if (( VOCO_UI_INTRO_START > 0 && VOCO_UI_NOW - VOCO_UI_INTRO_START < VOCO_UI_INTRO_MS )); then
      t=$((VOCO_UI_NOW - VOCO_UI_INTRO_START))
    fi
    if (( t >= VOCO_UI_SHINE_AT && t < VOCO_UI_SHINE_AT + VOCO_UI_SHINE_MS )); then
      s=$((t - VOCO_UI_SHINE_AT))
    elif (( VOCO_UI_SHINE_START > 0 && VOCO_UI_NOW - VOCO_UI_SHINE_START < VOCO_UI_SHINE_MS )); then
      s=$((VOCO_UI_NOW - VOCO_UI_SHINE_START))
    fi
  fi
  VOCO_UI_CARD_RESTS=false
  (( t < VOCO_UI_INTRO_MS || s >= 0 )) || VOCO_UI_CARD_RESTS=true
  if [[ "$VOCO_UI_CARD_RESTS" == true && -n "$VOCO_UI_FINAL_TOP" ]]; then
    VOCO_UI_CARD_TOP=$VOCO_UI_FINAL_TOP VOCO_UI_CARD_BOTTOM=$VOCO_UI_FINAL_BOTTOM
    VOCO_UI_CARD_SWEEP=$VOCO_UI_CARD_WIDTH VOCO_UI_CARD_REVEAL=14
    VOCO_UI_CARD_LEFT=("${VOCO_UI_LEFT[@]}") VOCO_UI_CARD_RIGHT=("${VOCO_UI_FINAL_RIGHT[@]}")
    return
  fi
  voco_ui_card_at "$t" "$s"
  if [[ "$VOCO_UI_CARD_RESTS" == true ]]; then
    VOCO_UI_FINAL_TOP=$VOCO_UI_CARD_TOP VOCO_UI_FINAL_BOTTOM=$VOCO_UI_CARD_BOTTOM
    VOCO_UI_FINAL_RIGHT=("${VOCO_UI_CARD_RIGHT[@]}")
  fi
}

# What this process last drew, so a frame redraws only what changed: the sweep's
# position, which sets the edges and left parts, the right parts, the image's
# reveal, whether the card rests, the heading and the progress lines. Unknown
# once the canvas opens or clears, or another process drew.
voco_ui_forget() {
  VOCO_UI_SHOWN_SWEEP=-1 VOCO_UI_SHOWN_LEFT=-1 VOCO_UI_SHOWN_RIGHT=() VOCO_UI_SHOWN_REVEAL=-1
  VOCO_UI_SHOWN_RESTS=false VOCO_UI_SHOWN_HEADING='' VOCO_UI_SHOWN_LINES=() VOCO_UI_SHOWN_PROGRESS=''
}

# True while the intro or a shine is still moving.
voco_ui_animating() {
  [[ "$VOCO_UI_ART" == true && "$VOCO_UI_NO_MOTION" != true ]] || return 1
  voco_ui_now_ms
  (( (VOCO_UI_INTRO_START > 0 && VOCO_UI_NOW - VOCO_UI_INTRO_START < VOCO_UI_INTRO_MS) ||
     (VOCO_UI_SHINE_START > 0 && VOCO_UI_NOW - VOCO_UI_SHINE_START < VOCO_UI_SHINE_MS) ))
}

voco_ui_init() {
  voco_ui_configure
  [[ "$VOCO_TERMINAL_MOTION" == true && -z "$VOCO_UI_TIMER_FD" ]] || return 0
  # An owned, unlinked FIFO gives read -t a timer without a sleep subprocess. It
  # lives in its own private directory, so the intro can play before downloads.
  local folder
  folder=$(mktemp -d) || return 0
  if mkfifo -m 600 "$folder/ui-timer"; then exec {VOCO_UI_TIMER_FD}<>"$folder/ui-timer"; fi
  rm -rf -- "$folder"
}

voco_ui_size() {
  local bytes="$1" unit=KiB divisor=1024
  if (( bytes >= 1048576 )); then unit=MiB; divisor=1048576; fi
  printf -v VOCO_UI_SIZE '%d.%d %s' "$((bytes/divisor))" "$((bytes%divisor*10/divisor))" "$unit"
}

# One bounded canvas is shared by every normal installation stage. A frame
# redraws only the lines that changed since this process last drew them, and of
# a card row only its right part when that is all that changed, which leaves the
# microphone, and any image over it, untouched. With "progress" as the fourth
# argument a resting card isn't even built, and only the progress lines change.
voco_ui_frame() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  local title="$1" detail="$2" mark="${3:-—}" card="${4:-full}" width i r color symbol line2='' stages=''
  local key frame left heading=''
  local rule='────────────────────────────────────────────────────────'
  local -a labels=(Check Download Verify Install)
  width=$((${VOCO_TERMINAL_COLUMNS:-80}-5))
  if (( ${#detail} > width )); then
    local head="${detail:0:width}"
    if [[ "$head" == *' '* ]]; then head="${head% *}"; fi
    line2="${detail:${#head}}"; line2="${line2# }"; detail="$head"
  fi
  key="$title|$detail|$mark|$VOCO_UI_STAGE|$VOCO_UI_NOTE|$width"
  if [[ "$key" != "$VOCO_UI_PROGRESS_KEY" ]]; then
    for i in 0 1 2 3; do
      symbol='○'; color="$VOCO_UI_MUTED"
      if (( i < VOCO_UI_STAGE )); then symbol='✓'; color="$VOCO_UI_COMPLETE"
      elif (( i == VOCO_UI_STAGE )); then symbol='›'; color="$VOCO_UI_ACTIVE"; fi
      stages+="${color}${symbol} ${labels[i]}${NC}   "
    done
    color="$VOCO_UI_SILVER"
    [[ "$mark" != '✓' ]] || color="$VOCO_UI_COMPLETE"
    VOCO_UI_PROGRESS=($'\r\e[K')
    printf -v 'VOCO_UI_PROGRESS[1]' '\r\033[K  %b%s%b' "$color" "$mark" "$NC"
    printf -v 'VOCO_UI_PROGRESS[2]' '\r\033[K  %s' "${title:0:width}"
    printf -v 'VOCO_UI_PROGRESS[3]' '\r\033[K  %s' "$detail"
    printf -v 'VOCO_UI_PROGRESS[4]' '\r\033[K  %s' "${line2:0:width}"
    printf -v 'VOCO_UI_PROGRESS[5]' '\r\033[K  %s' "${rule:0:width}"
    printf -v 'VOCO_UI_PROGRESS[6]' '\r\033[K  %b' "$stages"
    printf -v 'VOCO_UI_PROGRESS[7]' '\r\033[K  %s' "${VOCO_UI_NOTE:0:width}"
    VOCO_UI_PROGRESS_KEY=$key
  fi
  if [[ "$VOCO_UI_ART" == true && ( "$card" == progress || "$VOCO_UI_SHOWN_RESTS" == true ) ]] && ! voco_ui_animating; then
    printf -v frame '\033[%dA' "$VOCO_UI_PROGRESS_LINES"
  elif [[ "$VOCO_UI_ART" == true ]]; then
    voco_ui_card
    VOCO_UI_SHOWN_RESTS=$VOCO_UI_CARD_RESTS
    printf -v frame '\033[%dA' "$VOCO_UI_LINES"
    # The edges follow the sweep, and the rows' left parts follow it until it is
    # past the microphone; only the right parts change after that.
    left=$(( VOCO_UI_CARD_SWEEP < 17 ? VOCO_UI_CARD_SWEEP : 17 ))
    if [[ "$VOCO_UI_CARD_SWEEP" != "$VOCO_UI_SHOWN_SWEEP" ]]; then
      frame+=$'\r\e[K  '"$VOCO_UI_CARD_TOP"$'\e[0m\n'
    else
      frame+=$'\n'
    fi
    for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
      if [[ "$left" != "$VOCO_UI_SHOWN_LEFT" ]]; then
        frame+=$'\r\e[K  '"${VOCO_UI_CARD_LEFT[r]}${VOCO_UI_CARD_RIGHT[r]}"$'\e[0m\n'
      elif [[ "${VOCO_UI_CARD_RIGHT[r]}" != "${VOCO_UI_SHOWN_RIGHT[r]}" ]]; then
        # Column 19 is the card's column 16, after the microphone.
        frame+=$'\e[19G'"${VOCO_UI_CARD_RIGHT[r]}"$'\e[0m\e[K\n'
      else
        frame+=$'\n'
      fi
    done
    if [[ "$VOCO_UI_CARD_SWEEP" != "$VOCO_UI_SHOWN_SWEEP" ]]; then
      frame+=$'\r\e[K  '"$VOCO_UI_CARD_BOTTOM"$'\e[0m\n'
    else
      frame+=$'\n'
    fi
    # The image goes over the microphone cells again whenever they were drawn,
    # from just after the card.
    if [[ "$VOCO_UI_MIC_MODE" == kitty ]] &&
        [[ "$left" != "$VOCO_UI_SHOWN_LEFT" || "$VOCO_UI_CARD_REVEAL" != "$VOCO_UI_SHOWN_REVEAL" ]]; then
      (( VOCO_UI_CARD_REVEAL < 1 )) || frame+=${VOCO_UI_PLACE[VOCO_UI_CARD_REVEAL]}
      VOCO_UI_SHOWN_REVEAL=$VOCO_UI_CARD_REVEAL
    fi
    VOCO_UI_SHOWN_RIGHT=("${VOCO_UI_CARD_RIGHT[@]}") VOCO_UI_SHOWN_LEFT=$left VOCO_UI_SHOWN_SWEEP=$VOCO_UI_CARD_SWEEP
  else
    printf -v frame '\033[%dA' "$VOCO_UI_LINES"
    printf -v heading '\r\033[K  %bV O C O%b  v%s\n\r\033[K  The voice layer for Linux. Today: private dictation.\n' \
      "$VOCO_UI_SILVER" "$NC" "${VERSION:-}"
    if [[ "$heading" != "$VOCO_UI_SHOWN_HEADING" ]]; then frame+=$heading; else frame+=$'\n\n'; fi
    VOCO_UI_SHOWN_HEADING=$heading
  fi
  if [[ "$key" != "$VOCO_UI_SHOWN_PROGRESS" ]]; then
    for ((i=0; i<VOCO_UI_PROGRESS_LINES; i++)); do
      if [[ "${VOCO_UI_PROGRESS[i]}" != "${VOCO_UI_SHOWN_LINES[i]-}" || -z "$VOCO_UI_SHOWN_PROGRESS" ]]; then
        frame+=${VOCO_UI_PROGRESS[i]}$'\n'
      else
        frame+=$'\n'
      fi
    done
    VOCO_UI_SHOWN_LINES=("${VOCO_UI_PROGRESS[@]}") VOCO_UI_SHOWN_PROGRESS=$key
  else
    frame+=$'\n\n\n\n\n\n\n\n'
  fi
  # A terminating sweep may stop while building the frame, but must never leave
  # the cursor between rows. Bash runs the termination trap after this builtin.
  printf '%s' "$frame"
}

voco_ui_begin() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  voco_ui_pause
  if [[ "$VOCO_UI_OPEN" != true ]]; then
    local lines
    printf -v lines '%*s' "$VOCO_UI_LINES" ''
    printf '%s' "${lines// /$'\n'}"
    VOCO_UI_OPEN=true
    voco_ui_forget
    # The intro plays once, the first time the canvas opens.
    if [[ "$VOCO_UI_ART" == true && "$VOCO_UI_NO_MOTION" != true ]] && (( VOCO_UI_INTRO_START == 0 )); then
      voco_ui_now_ms
      VOCO_UI_INTRO_START=$VOCO_UI_NOW
    fi
  fi
  VOCO_UI_TITLE="$1"
  voco_ui_frame "$1" "${2:-}" "${3:-—}"
}

# Keep the intro or a shine moving after a frame: about 30 frames a second, in the
# background, until both are done. Every foreground frame pauses it first.
voco_ui_animate() {
  [[ -n "$VOCO_UI_TIMER_FD" ]] && voco_ui_animating || return 0
  (
    trap - EXIT
    trap 'exit 0' TERM INT
    while voco_ui_animating; do
      voco_ui_frame "$1" "$2" "$3"
      IFS= read -r -t .033 -u "$VOCO_UI_TIMER_FD" _ || true
    done
    voco_ui_frame "$1" "$2" "$3"
  ) &
  VOCO_UI_PID=$!
}

# End any intro or shine now, so the next frame shows the card at rest. The last
# frame of a fast install uses this instead of waiting for the intro.
voco_ui_settle() {
  voco_ui_pause
  VOCO_UI_INTRO_START=1 VOCO_UI_SHINE_START=0
}

# A foreground frame that leaves any intro or shine still moving.
voco_ui_show() {
  voco_ui_pause
  voco_ui_frame "$1" "$2" "${3:-—}"
  voco_ui_animate "$1" "$2" "${3:-—}"
}

voco_ui_stage() {
  VOCO_UI_STAGE="$1"
  if [[ "$VOCO_TERMINAL_MOTION" == true ]]; then
    if [[ -n "$VOCO_UI_TIMER_FD" ]]; then voco_ui_sweep "$2" "${3:-}"; else voco_ui_begin "$2" "${3:-}"; fi
  else
    dim "$2"
    [[ -z "${3:-}" ]] || dim "$3"
  fi
}

voco_ui_sweep() {
  voco_ui_begin "$1" "$2"
  [[ "$VOCO_TERMINAL_MOTION" == true && "$VOCO_UI_NO_MOTION" != true ]] || return 0
  voco_ui_now_ms
  # Each stage lights the wordmark once, unless the intro is still playing.
  if (( VOCO_UI_INTRO_START == 0 || VOCO_UI_NOW - VOCO_UI_INTRO_START >= VOCO_UI_INTRO_MS )); then
    VOCO_UI_SHINE_START=$VOCO_UI_NOW
  fi
  voco_ui_animate "$1" "$2" '—'
}

voco_ui_pause() {
  if [[ -n "$VOCO_UI_PID" ]]; then
    kill "$VOCO_UI_PID" 2>/dev/null || true
    wait "$VOCO_UI_PID" 2>/dev/null || true
    VOCO_UI_PID=""
    # Its frames changed the canvas behind this process's back.
    voco_ui_forget
  fi
}

voco_ui_release() {
  voco_ui_pause
  if [[ "$VOCO_UI_OPEN" == true ]]; then
    # The image would stay where the canvas was, so it goes first.
    local lines unplace=''
    [[ "$VOCO_UI_ART" != true ]] || unplace=$VOCO_UI_UNPLACE
    printf -v lines '%*s' "$VOCO_UI_LINES" ''
    printf '%s\033[%dA%s\033[%dA\r' "$unplace" "$VOCO_UI_LINES" "${lines// /$'\r\e[K\n'}" "$VOCO_UI_LINES"
  fi
  VOCO_UI_OPEN=false
  voco_ui_forget
}

voco_ui_download_observer() {
  trap - EXIT
  trap 'exit 0' TERM INT
  local destination="$1" start="$2" bytes=0 now delta rate elapsed mark='' detail='' sampled=0 card=full
  local glyphs=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █) value
  VOCO_UI_LAST_BYTES=0
  VOCO_UI_LAST_TIME=${EPOCHREALTIME/./}
  voco_ui_now_ms
  # The download lights the wordmark once, unless the intro is still playing.
  if [[ "$VOCO_UI_NO_MOTION" != true ]] && (( VOCO_UI_INTRO_START == 0 || VOCO_UI_NOW - VOCO_UI_INTRO_START >= VOCO_UI_INTRO_MS )); then
    VOCO_UI_SHINE_START=$VOCO_UI_NOW
  fi
  while :; do
    now=${EPOCHREALTIME/./}
    # Sample at 4 Hz, whatever the frame rate; only shell builtins run between samples.
    if (( now - sampled >= 250000 )); then
      sampled=$now
      bytes=$(stat -c %s -- "$destination" 2>/dev/null || printf '0')
      now=${EPOCHREALTIME/./}
      delta=$((now-VOCO_UI_LAST_TIME))
      rate=0
      if (( delta > 0 && bytes >= VOCO_UI_LAST_BYTES )); then rate=$(((bytes-VOCO_UI_LAST_BYTES)*1000000/delta)); fi
      VOCO_UI_LAST_BYTES=$bytes; VOCO_UI_LAST_TIME=$now
      VOCO_UI_RATES=("${VOCO_UI_RATES[@]:1}" "$rate")
      elapsed=$((SECONDS-start))
      voco_ui_size "$bytes"; detail="$VOCO_UI_SIZE received"
      if (( elapsed > 0 )); then
        voco_ui_size "$((bytes/elapsed))"; detail+=" · $VOCO_UI_SIZE/s avg"
      fi
      mark=''
      if [[ "$VOCO_UI_NO_MOTION" == true ]]; then mark='↓'; else
        # A fixed logarithmic scale keeps rates comparable without needing a known total.
        for value in "${VOCO_UI_RATES[@]}"; do
          if (( value == 0 )); then mark+='· '; else
            value=$((value/131072)); local level=0
            while (( value > 1 && level < 7 )); do value=$((value/2)); level=$((level+1)); done
            mark+="${glyphs[level]} "
          fi
        done
      fi
    fi
    if voco_ui_animating; then
      voco_ui_frame 'Bringing VOCO to your desktop.' "$detail" "$mark"
      card=full
      IFS= read -r -t .033 -u "$VOCO_UI_TIMER_FD" _ || true
    else
      # Once the card has drawn at rest, it stays on screen untouched.
      voco_ui_frame 'Bringing VOCO to your desktop.' "$detail" "$mark" "$card"
      card=progress
      IFS= read -r -t .25 -u "$VOCO_UI_TIMER_FD" _ || true
    fi
  done
}

voco_ui_close() {
  voco_ui_pause
  # An interrupted probe leaves echo off: give the terminal its settings back.
  if [[ -n "$VOCO_UI_PROBE_TTY" ]]; then
    stty "$VOCO_UI_PROBE_TTY" 2>/dev/null < /dev/tty || true
    VOCO_UI_PROBE_TTY=''
  fi
  # An APT display stopped mid-write can leave an escape sequence open: ST ends it.
  [[ "$VOCO_UI_APT_DRAWING" != true ]] || printf '\033\\'
  if [[ -n "$VOCO_UI_TIMER_FD" ]]; then exec {VOCO_UI_TIMER_FD}>&-; VOCO_UI_TIMER_FD=""; fi
}

voco_run_apt() {
  local result=0
  local wrapper='exec 3>&1 1>&2; exec apt-get -q=2 -o APT::Status-Fd=3 -o Dpkg::Use-Pty=0 install -y -- "$@"'
  local output_fd fifo="$VOCO_DOWNLOAD_DIR/apt-output"
  local -a statuses
  # Minimal systems use APT's own presentation until Python is installed. There
  # is never a download/install of a framework just to display progress.
  if [[ "$VOCO_TERMINAL_MOTION" != true || ! -t 0 ]] || ! command -v python3 >/dev/null 2>&1; then
    voco_ui_release
    sudo apt-get install -y -- "$@"
    return $?
  fi
  if ! sudo -n -v >/dev/null 2>&1; then
    voco_ui_release
    dim 'VOCO · Ubuntu needs your permission to install.'
    sudo -v || return $?
  fi
  # Respect sudo policies that permit apt-get but not an exec wrapper. Do not ask
  # owners to broaden permissions just for presentation.
  if ! sudo -n -l -- sh -c "$wrapper" voco-apt "$@" >/dev/null 2>&1; then
    voco_ui_release
    sudo apt-get install -y -- "$@"
    return $?
  fi
  voco_ui_release
  # The APT renderer owns and clears its canvas, including prompt handoffs.
  [[ -n "$VOCO_INSTALL_LOG" ]] || VOCO_INSTALL_LOG=$(mktemp "${TMPDIR:-/tmp}/voco-install.XXXXXX.log")
  mkfifo -m 600 "$fifo"
  exec {output_fd}<>"$fifo"
  rm -f -- "$fifo"
  # APT marks its status descriptor close-on-exec before dpkg starts. A dedicated
  # fd is essential: using stdout would close maintainer-script output. Create fd
  # 3 AFTER sudo, with a fixed wrapper and separate arguments (never interpolation).
  voco_ui_apt_card
  VOCO_UI_APT_DRAWING=true
  if sudo sh -c "$wrapper" voco-apt "$@" 2>&"$output_fd" |
      voco_apt_display "$VOCO_INSTALL_LOG" "$VOCO_UI_NO_MOTION" separate "${VERSION:-}" "$VOCO_UI_LINES" \
        "$VOCO_UI_APT_CARD" "$VOCO_UI_APT_SHINE" "${VOCO_UI_PLACE[14]:-}" "$VOCO_UI_UNPLACE" 4<&"$output_fd"; then
    result=0
  else
    statuses=("${PIPESTATUS[@]}")
    result=${statuses[0]}
    (( result != 0 )) || result=${statuses[1]}
  fi
  VOCO_UI_APT_DRAWING=false
  exec {output_fd}>&-
  voco_ui_release
  if (( result != 0 )); then
    VOCO_KEEP_LOG=true
    dim "Installation details: $VOCO_INSTALL_LOG"
  fi
  return "$result"
}

voco_run_dnf() {
  # DNF keeps its own presentation, prompts included; VOCO only hands it a
  # clear terminal and says who is asking for the password.
  voco_ui_release
  if ! sudo -n -v >/dev/null 2>&1; then
    dim 'VOCO · Fedora needs your permission to install.'
  fi
  sudo dnf install -y -- "$@"
}
