# Provenance

This package publishes **our own factual registry** of tide and current stations.
It is not a copy of any provider's station file. This document records where each
field comes from, so the claim is auditable rather than asserted.

## Why this matters

Station identity — an id, a name, a latitude and longitude — is **fact**, and facts
are not copyrightable. Two courts, in the two jurisdictions this project operates in,
say so directly:

- **US** — *Feist Publications v. Rural Telephone* (1991). A phone book's white pages
  got zero copyright protection: compiling facts, however laborious, is not authorship.
  Only an *original selection, coordination, or arrangement* can be thinly protected, and
  the underlying facts stay free for anyone to re-extract. "Sweat of the brow" was
  explicitly rejected.
- **Canada** — *CCH Canadian v. Law Society of Upper Canada* (2004). Originality requires
  "skill and judgment," not mere labour. A factual list with an obvious arrangement is not
  protected.

Neither the US nor Canada has a EU-style *sui generis* database right, so the labour of
assembling a station list creates no separate right here.

**Completeness is the weakest position for a compilation claim, not the strongest.**
Compilation copyright rewards original *selection* — deciding what to leave out. A complete
list is by definition unselective, so there is no protectable selection left. Covering
every gate in a region works *for* us on this point, not against.

## The real constraint: don't redistribute a provider's file

Copyright is not the live risk. **Licensing and terms-of-use are** — that is contract,
separable from copyright. If we pulled a provider's station export under a license, its
redistribution terms could bind us even though the facts inside are free.

So the rule is simple and it is a rule about *method*, not about which facts appear:

> **We publish independently obtained, human-reviewed facts. We do not redistribute any
> provider's station file.**

A record here that happens to agree with CHS on a coordinate is facts agreeing with facts.
A byte-for-byte copy of CHS's station export would be redistributing their file — that is
the line, and this package stays on the right side of it.

## Per-field provenance

Each registry record is assembled field by field. It is not one document lifted from one
source.

| Field | Origin |
|-------|--------|
| `name` | **Hand-written label.** Renaming and re-casing shouting provider names (`CHERRY POINT` → `Cherry Point`) is the whole point of this package — original editorial work, reviewed by a person. |
| `context`, `cities`, `aliases` | **Hand-written here.** Not present in provider data; original. |
| `kind` | **Our editorial classification** (`tide` / `current`), assigned by a person against the membership rules the registry writes down — not a field copied from any provider. |
| `tideReference` / `derived.reference` | **Editorial pairing.** Which tide reference port's water to show beside a current gate: the *nearest* `kind: tide` port in the gate's tidal regime, chosen from the positions in this file and, where one exists, confirmed against standard published secondary-reference practice (e.g. Seymour Narrows → Campbell River). A judgment about real water, expressed as an internal registry key on both sides — no provider handle. |
| `position` | **Independently derived and human-verified.** Current-gate positions come from the `chs-constituents` fitting pipeline and `currents-vault` pass frontmatter, cross-checked against `chs-constituents/stations/salish-sea.json`. Tide reference-port positions come from CHS's public prediction-station list, matched by position and confirmed in water by the coastline audit. Both are audited against a coastline and reviewed by a person — a hand-picked set of factual coordinates that happen to agree with CHS, not a lifted copy of a CHS station export. |
| provider id | **Deliberately absent.** The registry carries no provider-minted identifier at all — not even as a reference. A consumer joins a record here to a provider's live data by name; the provider's own opaque handle is resolved at runtime by whoever holds a licence to that provider's API, and it never enters this repository. |

The honest summary: the *names, context, and positions* are our work, and there is no
provider handle in the published data at all — the one field that would point *into* a
provider's system is the one field we chose not to ship.

## Human review

Every station's identity is reviewed by a person before it lands. Positions are audited
against a bundled coastline (`station-corrections audit`) and a moved position shows up in a
lock diff (`station-corrections check`). This review is what converts overlapping facts into
our own verified factual work — see the `source` field on a `RegistryStation` for recording
a per-station provenance that deviates from the defaults above.

## For contributors

When you add or correct a station:

- **Do not paste a row out of a provider's station export.** Obtain the name, context, and
  position independently (chart, gazetteer, the fitting pipeline, direct observation) and
  write them here yourself.
- **Do not add a provider id field.** If your workflow needs the provider's opaque handle to
  join data at runtime, resolve it there, under your own licence to that provider's API — it
  does not belong in this repository.
- If a station's facts came from somewhere other than the defaults in the table above,
  record it in that station's `source` field so the trail stays auditable.
