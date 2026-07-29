# bloomreach-sfra

Custom Bloomreach Discovery integration and search-powered browse experiences for the Ariat SFRA storefront: Boot Finder, Comparison Tool, Work Job Landing Pages, Thematic SEO Pages, and a Loomi stub.

This repository holds only the two cartridges that implement the integration:

- `int_ariat_bloomreach` — Bloomreach service layer and shared query/identity helpers
- `app_ariat_search_experience` — controllers, templates, and client-side JS for the storefront experience

## Parent project

These cartridges do not run standalone — they extend Ariat's base SFRA storefront project (`ariat-dw`), which supplies `app_ariat_core` and the rest of the base/integration cartridges, along with the SFCC site configuration. `ariat-dw` is a separate repository and is **not vendored into this repo**; clone it as a sibling directory:

```
workspace/
├── ariat-dw/          # parent SFRA project (app_ariat_core, base cartridges, build tooling)
└── bloomreach-sfra/   # this repo
```

### Cartridge path

The required Business Manager cartridge path (see `docs/TECHNO_FUNCTIONAL_GUIDE.md` §3.2) is:

```
app_ariat_search_experience:int_ariat_bloomreach:[base_sfra_cartridges]
```

Both cartridges from this repo must be listed **before** the base cartridges supplied by `ariat-dw` so their controllers, templates, and shared scripts take precedence.

### Local setup

1. Clone `ariat-dw` as a sibling of this repo (see layout above).
2. Copy `dw.json.example` to `dw.json` and fill in your sandbox credentials. `dw.json` is gitignored.
3. `.vscode/settings.json` already points the Prophet extension's cartridge path at both `./cartridges` and `../ariat-dw/cartridges` for cross-project code navigation and debugging.
4. `npm install`, then `npm run uploadCartridge` to push just this repo's two cartridges to your sandbox (upload `ariat-dw`'s cartridges separately, from that repo).

## Development

- `npm test` — unit tests (Mocha/Chai/Sinon)
- `npm run lint` — ESLint over `cartridges/`
