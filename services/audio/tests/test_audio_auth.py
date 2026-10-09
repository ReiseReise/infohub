import unittest

try:
    from app.services.auth_service import hash_password, verify_password
except ModuleNotFoundError:
    hash_password = None
    verify_password = None


@unittest.skipIf(verify_password is None, "host Python 未安装音频服务认证依赖")
class AudioAuthTests(unittest.TestCase):
    def test_verify_password_accepts_valid_bcrypt_hash(self):
        password_hash = hash_password("valid-password")

        self.assertTrue(verify_password("valid-password", password_hash))
        self.assertFalse(verify_password("wrong-password", password_hash))

    def test_verify_password_rejects_unknown_hash_without_raising(self):
        self.assertFalse(verify_password("password", "not-a-bcrypt-hash"))


if __name__ == "__main__":
    unittest.main()
