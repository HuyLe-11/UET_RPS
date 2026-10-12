import unittest

import engine


class EngineReplayTests(unittest.TestCase):
    def test_play_can_capture_legal_moves_without_changing_its_result(self):
        def first_legal_move(state):
            board, player = engine._decode(state)
            return engine.legal_moves(board, player)[0]

        bots = [engine.FuncBot(first_legal_move), engine.FuncBot(first_legal_move)]
        recorded = []

        result = engine.play(bots, max_plies=1, moves=recorded)

        self.assertEqual(result, engine.play(bots, max_plies=1))
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0][0], 0)
        self.assertEqual(len(recorded[0][1]), 4)

    def test_entry_opponents_are_separate_from_full_strength_bots(self):
        self.assertIs(engine.make_bot("entry:0").fn, engine.entry_btc0)
        self.assertIs(engine.make_bot("entry:1").fn, engine.entry_btc1)
        self.assertIs(engine.make_bot("entry:2").fn, engine.entry_btc2)
        self.assertIs(engine.make_bot("btc:0").fn, engine.btc0)
        self.assertIs(engine.make_bot("btc:1").fn, engine.btc1)
        self.assertIs(engine.make_bot("btc:2").fn, engine.btc2)

    def test_progress_entry_opponent_selects_an_advancing_move_when_available(self):
        state = engine.encode(engine.initial(), 0, 0)
        board, player = engine._decode(state)

        move = engine.entry_btc1(state)

        self.assertLess(
            engine._dist(move[2], move[3], engine.GOAL[player]),
            engine._dist(move[0], move[1], engine.GOAL[player]),
        )
        self.assertIn(move, engine.legal_moves(board, player))


if __name__ == "__main__":
    unittest.main()
