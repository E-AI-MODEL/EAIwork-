import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from pr_backlog_audit import classify, inspect_files, markdown


class BacklogAuditTests(unittest.TestCase):
    def test_detects_byte_exact_matches_and_new_files(self):
        changes = [
            {"filename": "a.py", "sha": "a1"},
            {"filename": "b.py", "sha": "b1"},
            {"filename": "c.py", "sha": "c1"},
        ]
        result = inspect_files(changes, {"a.py": "a1", "b.py": "new"})
        self.assertEqual(result["identical"], ["a.py"])
        self.assertEqual(result["different"], ["b.py"])
        self.assertEqual(result["missing"], ["c.py"])

    def test_same_files_are_not_called_safe_to_close(self):
        result = inspect_files([{"filename": "x", "sha": "same"}], {"x": "same"})
        self.assertIn("verifieer", classify({}, result))

    def test_modified_and_new_files_need_review(self):
        result = inspect_files([{"filename": "new.py", "sha": "abc"}], {})
        self.assertIn("Nieuwe bestanden", classify({}, result))

    def test_no_changed_files_is_not_a_finished_pr(self):
        self.assertIn("Geen gewijzigde", classify({}, inspect_files([], {})))

    def test_report_keeps_base_and_exact_head(self):
        report = {
            "repo": "E-AI-MODEL/EAIwork-",
            "main_sha": "fedcba",
            "prs": [{
                "number": 29, "title": "Worker changes", "url": "https://github.com/x/y/pull/29",
                "draft": True, "base": "feature/pr28", "head": "feature/pr29", "head_sha": "abc123",
                "files": {"total": 2, "identical": ["a"], "different": ["b"], "missing": []},
                "group": "Afwijkende inhoud, vergelijken",
            }],
        }
        text = markdown(report)
        self.assertIn("feature/pr28", text)
        self.assertIn("abc123", text)
        self.assertIn("https://github.com/x/y/pull/29", text)
        self.assertNotIn("kan gesloten", text)

if __name__ == "__main__":
    unittest.main()
