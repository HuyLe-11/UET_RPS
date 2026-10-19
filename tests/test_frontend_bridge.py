"""Exercise the real Flask/SQLite path used by React, without a Supabase account."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from data import local_auth


class FrontendBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.paths = patch.multiple(server.T, DB=str(root / "ott.db"), BOT_DIR=str(root / "bots"),
                                    SNAP=str(root / "snaps"), LIVE_BOARD_SNAPSHOT=str(root / "live.json"))
        self.paths.start()
        self.mode = patch.multiple(server, A=local_auth, AUTH_MODE="demo")
        self.mode.start()
        self.auth_state = patch.multiple(local_auth, _accounts=dict(local_auth._accounts),
                                         _sessions={}, _refresh_tokens={})
        self.auth_state.start()
        server.T.init()
        with server._admin_job_lock:
            server._admin_job = None
        self.client = server.app.test_client()
        self.csrf = self.client.get("/api/auth/session").json["csrf"]

    def tearDown(self):
        self.auth_state.stop()
        self.mode.stop()
        self.paths.stop()
        self.temp.cleanup()

    def post(self, path, data):
        response = self.client.post(path, json=data, headers={"X-CSRF-Token": self.csrf})
        if response.is_json and response.json.get("csrf"):
            self.csrf = response.json["csrf"]
        return response

    def login(self):
        response = self.post("/api/auth/login", {"name": "demo", "password": "Demo@123456"})
        self.assertEqual(response.status_code, 200, response.json)
        return response

    def test_login_cookie_session_actual_upload_and_logout(self):
        self.assertIsNone(self.client.get("/api/auth/session").json["user"])
        self.assertEqual(self.client.get("/me").status_code, 401)
        self.login()
        self.assertEqual(self.client.get("/api/auth/session").json["user"]["name"], "demo")
        source = b"print('bot example')\n"
        response = self.client.post("/submit", data={"file": (io.BytesIO(source), "bot.py")},
                                    headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(Path(server.T.BOT_DIR, "demo", "latest.py").read_bytes(), source)
        self.assertEqual(len(server.T.q("select * from subs where name='demo'")), 1)
        self.assertEqual(self.client.get("/me").json["name"], "demo")
        self.assertEqual(self.client.get("/leaderboard").json, [])
        self.assertEqual(self.client.get("/replays").json["matches"], [])
        self.assertEqual(self.post("/api/auth/logout", {}).status_code, 200)
        self.assertEqual(self.client.get("/me").status_code, 401)
        # Logout must revoke the server session, not just delete a React variable.
        self.assertEqual(local_auth._sessions, {})

    def test_real_standings_and_replay_are_returned(self):
        self.login()
        T = server.T
        T.register("opponent")
        T.put("phase", "round")
        T.put("round", 1)
        T.put("day", 2)
        T.qm("insert into member values(?,?,?,?)", [(1,"demo",0,0),(1,"opponent",0,1)])
        T.qm("insert into daily values(?,?,?,?,?,?,?,?)",
             [(1,1,0,"demo",1,2,1,2), (1,1,0,"opponent",-1,-2,2,2)])
        games = [{"players":["a","b"],"result":1,"moves":[[0,[0,0,1,1]]]}]
        T.q("insert into matches values(?,?,?,?,?,?)", (1,1,1,"demo","opponent",2))
        T.q("insert into match_replays values(?,?,?,?,?,?)", (1,1,1,"demo","opponent",json.dumps(games)))
        self.assertEqual(self.client.get("/leaderboard").json[0]["name"], "demo")
        self.assertEqual(self.client.get("/replays").json["matches"][0]["games"], games)

    def test_csrf_invalid_login_invalid_file_and_admin_access(self):
        self.assertEqual(self.client.post("/api/auth/login", json={"name":"demo","password":"Demo@123456"}).status_code,403)
        self.assertEqual(self.post("/api/auth/login", {"name":"demo","password":"wrong"}).status_code,401)
        self.login()
        self.assertEqual(self.client.get("/admin/api/overview").status_code,403)
        self.assertEqual(self.client.post("/submit",data={"file":(io.BytesIO(b"print(1)"),"bot.py")}).status_code,403)
        invalid = self.client.post("/submit",data={"file":(io.BytesIO(b"print("),"bot.py")},headers={"X-CSRF-Token":self.csrf})
        self.assertEqual(invalid.status_code,400)
        invalid_type = self.client.post("/submit",data={"file":(io.BytesIO(b"print(1)"),"bot.txt")},headers={"X-CSRF-Token":self.csrf})
        self.assertEqual(invalid_type.status_code,400)
        self.assertFalse(Path(server.T.BOT_DIR,"demo","latest.py").exists())

    def test_register_and_login_after_logout(self):
        self.assertEqual(self.post("/api/auth/register", {"name":"new_player","password":"short"}).status_code,400)
        self.assertEqual(self.post("/api/auth/register", {"name":"new_player","password":"NewPassword123"}).status_code,201)
        self.assertEqual(self.client.get("/me").json["name"],"new_player")
        self.assertEqual(self.post("/api/auth/register", {"name":"new_player","password":"NewPassword123"}).status_code,400)
        self.post("/api/auth/logout",{})
        self.assertEqual(self.post("/api/auth/login", {"name":"new_player","password":"NewPassword123"}).status_code,200)
        self.assertNotIn("NewPassword123",local_auth._accounts["new_player"]["password_hash"])

    def test_expired_access_token_refreshes_and_keeps_user(self):
        self.login()
        with self.client.session_transaction() as session:
            tokens = dict(session["sb"])
            tokens["exp"] = 0
            session["sb"] = tokens
        self.assertEqual(self.client.get("/api/auth/session").json["user"]["name"],"demo")
        self.assertEqual(len(local_auth._sessions),1)

    def test_react_index_and_assets(self):
        import re
        built = Path(server.FRONTEND_DIR,"index.html")
        if not built.exists():
            self.skipTest("Run npm run build before testing static assets")
        with self.client.get("/") as response:
            self.assertEqual(response.status_code,200)
            assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"',response.get_data(as_text=True))
        self.assertEqual(len(assets),2)
        for asset in assets:
            with self.client.get(asset) as response:
                self.assertEqual(response.status_code,200)

    def test_supabase_profile_matches_react_user_shape(self):
        profile = {"id":"external-id","username":"participant","role":"contestant","status":"active"}
        user = server.frontend_user(profile)
        self.assertEqual(user["name"],"participant")
        self.assertEqual(user["role"],"player")
        self.assertEqual(profile["role"],"contestant")


if __name__ == "__main__":
    unittest.main()
