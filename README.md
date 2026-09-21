# اوردرات — Orderat browser MVP

Pitch-ready browser MVP for Bahrain home sellers. Basic captures copied text, screenshots, voice notes and manual orders without accessing WhatsApp or Instagram. The owner reviews every draft before it enters the order book and day plan.

Ready Stock tracks finished items, automatically reserves quantities for open confirmed orders, flags product-level shortages, and shows what remains available to sell. Sales Analytics uses current product prices to estimate booked sales, average order value, units, bestsellers, order sources and fulfilment progress. These features remain device-local in the prototype.

Every order records its customer channel and intake method separately. Automatic Pro examples retain the WhatsApp customer number or Instagram username. Manually captured orders also retain their stated source and customer reference. Source details appear in the order list, order details, review form, analytics and CSV export.

The Plans screen presents the proposed BHD 9 Basic and BHD 15 Pro tests. Pro includes a pre-subscription readiness checklist for WhatsApp Business, a Meta business account, possible Meta verification, and a professional Instagram account. Pro remains marked as pending Meta app review; no payment or account connection is performed in the prototype.

The interactive product is served from `public/orderat`. It stores prototype records on the current device. Text extraction is a limited local demonstration; live AI, authentication, cloud sync, Meta APIs, customer replies and subscription billing are not connected.

The visual and verbal system is documented in `BRAND_GUIDELINES.md`. Orderat uses IBM Plex Sans Arabic and IBM Plex Sans in Regular 400 and Bold 700, with a flat operational palette and direct, owner-controlled language.

Light and dark modes use the same brand tokens. On mobile, the bottom navigation keeps Today, Order Book and Ready Stock visible; Day Plan, Sales, Products, Plans and Settings sit behind a single More menu.

Run with `npm run dev` or create the static export with `npm run build`.
