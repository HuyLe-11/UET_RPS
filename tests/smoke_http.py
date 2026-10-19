"""Optional HTTP smoke check for a running backend in local demo mode.

python -X utf8 tests/smoke_http.py http://127.0.0.1:8000
Does not upload files, grade matches or change contest results.
"""
import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(path):
        with client.open(base + path, timeout=10) as response:
            return response.read().decode()

    def post(path, data, csrf):
        req = urllib.request.Request(base + path, data=json.dumps(data).encode(),
                                     headers={"Content-Type":"application/json", "X-CSRF-Token":csrf})
        with client.open(req, timeout=10) as response:
            return json.load(response)

    session = json.loads(get("/api/auth/session"))
    if session["mode"] != "demo":
        raise SystemExit("This smoke check requires OTT_AUTH_MODE=demo")
    login = post("/api/auth/login", {"name":"demo","password":"Demo@123456"}, session["csrf"])
    assert login["user"]["name"] == "demo"
    assert json.loads(get("/me"))["name"] == "demo"
    assert json.loads(get("/api/auth/session"))["user"]["name"] == "demo"
    html = get("/")
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    assert len(assets) == 2
    for asset in assets:
        get(asset)
    post("/api/auth/logout", {}, login["csrf"])
    try:
        get("/me")
    except urllib.error.HTTPError as error:
        assert error.code == 401
    else:
        raise AssertionError("Logout did not end authorization")
    print("HTTP OK: login, session cookie, /me, React assets, logout, authorization")


if __name__ == "__main__":
    main()
