"""
state.py
────────
Shared in-memory session state (single-user).

All routers import `session` from here so they all touch the same dict.
To add a new piece of persistent state, just use session["your_key"] = ...
in any router — nothing else needs to change.

Keys written by the GDS router:
  lib         – parsed GDS library dict
  raw         – original GDS bytes
  filename    – uploaded filename
  designs     – list of detected bounding-box dicts
  arrays      – list of grouped-device dicts
  active_cell – currently-selected cell name
"""

# Single shared dict — mutated in place by all routers.
session: dict = {}
