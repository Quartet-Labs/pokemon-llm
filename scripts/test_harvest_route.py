#!/usr/bin/env python3
"""Tests for the route layer in scripts/harvest-emulator.py.

Both things covered here are silent failures rather than crashes, which is why
they get tests: a route that walks the wrong way and a route that abandons a
waypoint both produce a full, plausible-looking trajectory. The only signal is
in the rows, and by then the harvest has already been fed to build_sft.py.

State snippets below are shaped like real `/state` payloads from the live
server — Viridian's Pokémon Centre for the heal gate, Route 1 and Pallet Town
for the blocked-cell keying.

    python3 scripts/test_harvest_route.py
"""
import importlib.util
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# The harvest is a script, not a module, and its filename has a hyphen.
_spec = importlib.util.spec_from_file_location(
    "harvest_emulator", os.path.join(HERE, "harvest-emulator.py"))
harvest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harvest)


def view(map_id, party=(), pos=None):
    return {"area": {"id": map_id},
            "player": {"position": pos or {"x": 3, "y": 3},
                       "party": list(party)}}


class PartyHealthy(unittest.TestCase):
    """The gate for the Viridian Centre heal.

    The nurse's sequence measured 13 A-presses — a greeting, a HEAL/CANCEL
    prompt that defaults to HEAL, and the machine animation. Nothing guarantees
    that count, and there is no 'the nurse is finished' flag, so the route
    watches the HP itself.
    """

    def test_hurt_party_is_not_healthy(self):
        hurt = view(41, [{"name": "CHARMANDER", "hp": 10, "max_hp": 19}])
        self.assertFalse(harvest.cond_met(hurt, {"party_healthy": True}))

    def test_full_party_is_healthy(self):
        full = view(41, [{"name": "CHARMANDER", "hp": 19, "max_hp": 19}])
        self.assertTrue(harvest.cond_met(full, {"party_healthy": True}))

    def test_one_hurt_member_holds_the_gate(self):
        mixed = view(41, [{"hp": 19, "max_hp": 19}, {"hp": 4, "max_hp": 22}])
        self.assertFalse(harvest.cond_met(mixed, {"party_healthy": True}))

    def test_empty_party_is_not_healthy(self):
        # all() over nothing is True, which would fire the gate on the very
        # first press and skip the heal entirely — before the starter exists it
        # would fire in Red's bedroom.
        self.assertFalse(harvest.cond_met(view(41, []), {"party_healthy": True}))

    def test_unknown_condition_raises(self):
        with self.assertRaises(ValueError):
            harvest.cond_met(view(41), {"party_healed": True})


class BlockedCellScope(unittest.TestCase):
    """Refused cells are per-map.

    Pallet Town and Route 1 share most of their coordinate range, so a wall
    learned in one used to be believed in the other. The planner then routes
    around open grass and reports nothing — it looks exactly like terrain.
    """

    # (map_id, x, y): a fence in Pallet Town and a hedge on Route 1.
    LEARNED = {(0, 5, 6), (0, 9, 4), (12, 5, 6)}

    def test_only_this_maps_cells_apply(self):
        self.assertEqual(harvest.blocked_here(self.LEARNED, view(0)),
                         {(5, 6), (9, 4)})

    def test_same_coordinate_on_another_map_is_not_inherited(self):
        # (5,6) is refused on BOTH maps here and (9,4) only in Pallet; standing
        # on Route 1 we must see the first and not the second.
        self.assertEqual(harvest.blocked_here(self.LEARNED, view(12)),
                         {(5, 6)})

    def test_unvisited_map_starts_clean(self):
        self.assertEqual(harvest.blocked_here(self.LEARNED, view(1)), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
