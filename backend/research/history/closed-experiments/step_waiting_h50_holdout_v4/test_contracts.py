"""Synthetic authorization, immutable-dependency and truth-isolation checks."""
from copy import deepcopy
from hashlib import sha256
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from contracts import (HERE, V3, MISSING, canonical, gap_fill, primary_eligibility,
                       read, require_remote_proof, verify_v3)
from history_probe import IdentityMatcher, scan_stream
from review_history import vienna_work_prefix_only


def allowed():
    return dict(licenseKnown=True, researchUsePermitted=True,
                primaryQualificationRolePermitted=True, pairingEstablished=True,
                provenanceComplete=True, historyComplete=True,
                trainingOverlapStatus='NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
                historicalAcousticExposure=False, historicalProductDesignExposure=False)


class SourcePurpose(unittest.TestCase):
    def test_maestro_development_only_known_license_rejected(self):
        row = allowed() | {'primaryQualificationRolePermitted': False,
                           'license': 'CC BY-NC-SA 4.0'}
        self.assertFalse(primary_eligibility(row)['eligible'])

    def test_maestro_training_overlap_rejected(self):
        row = allowed() | {'trainingOverlapStatus': 'KNOWN_TRAINING_DOMAIN_OVERLAP'}
        self.assertFalse(primary_eligibility(row)['eligible'])

    def test_known_license_alone_insufficient(self):
        self.assertFalse(primary_eligibility({'licenseKnown': True})['eligible'])

    def test_unknown_purpose_rejected(self):
        row = allowed()
        del row['primaryQualificationRolePermitted']
        self.assertFalse(primary_eligibility(row)['eligible'])

    def test_vienna_authorized_evaluation_role_no_exposure(self):
        self.assertTrue(primary_eligibility(allowed())['eligible'])

    def test_noncommercial_is_not_research_prohibition(self):
        self.assertTrue(primary_eligibility(allowed() | {'license': 'CC BY-NC-SA 4.0'})['eligible'])

    def test_unknown_training_not_silently_cleared(self):
        self.assertFalse(primary_eligibility(allowed() | {'trainingOverlapStatus': 'UNKNOWN'})['eligible'])

    def test_unknown_history_rejected(self):
        self.assertFalse(primary_eligibility(allowed() | {'historyComplete': False})['eligible'])

    def test_product_design_exposure_rejected(self):
        self.assertFalse(primary_eligibility(allowed() | {'historicalProductDesignExposure': True})['eligible'])

    def test_deleted_history_exposure_rejected(self):
        # A deleted file is absent at HEAD but its blob remains in reachable history.
        with tempfile.TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=folder)
            git('init', '-q')
            path = Path(folder) / 'deleted-receipt.txt'
            path.write_text('batik exposure identity witness', encoding='ascii')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'receipt')
            blob = git('rev-parse', 'HEAD:deleted-receipt.txt').decode().strip()
            path.unlink()
            git('add', '-u')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'delete')
            content = git('cat-file', 'blob', blob)
            import re
            hits = scan_stream(io.BytesIO(content), len(content), re.compile(b'batik'), set())
            self.assertEqual(hits, ['batik'])
            row = allowed() | {'historicalAcousticExposure': bool(hits)}
            self.assertFalse(primary_eligibility(row)['eligible'])


class FrozenDependencies(unittest.TestCase):
    def test_vienna_work_prefix_is_not_batik_performance(self):
        self.assertTrue(vienna_work_prefix_only(['K331_1st-mov', 'k331_1st-mov_p07.match']))

    def test_exact_batik_audio_identity_cannot_be_dismissed_as_prefix(self):
        self.assertFalse(vienna_work_prefix_only(['k331_1.mp3']))
        self.assertFalse(vienna_work_prefix_only(['kv331_1']))

    def test_identity_matcher_reports_all_overlapping_aliases(self):
        matcher = IdentityMatcher({'batik', 'batik/midi/kv279_1.mid', 'kv279_1'})
        self.assertEqual(set(matcher.matches(b'batik/midi/kv279_1.mid')),
                         {'batik', 'batik/midi/kv279_1.mid', 'kv279_1'})

    def test_identity_matcher_preserves_cross_block_identity(self):
        content = b'x' * (1024 * 1024 - 2) + b'batik/kv279_1'
        self.assertEqual(scan_stream(io.BytesIO(content), len(content),
                                    IdentityMatcher({'batik/kv279_1'}), set()), ['batik/kv279_1'])

    def test_midi_hash_probe_does_not_parse_events(self):
        content = b'not even a musical MIDI file; byte identity only'
        digest = sha256(content).hexdigest()
        self.assertEqual(scan_stream(io.BytesIO(content), len(content), IdentityMatcher(set()),
                                     {digest}, True), [digest])

    def test_v3_pair_identity_unchanged(self):
        self.assertIn('pair_identity.py', [Path(r['path']).name for r in verify_v3()])

    def test_v3_selector_unchanged(self):
        self.assertIn('selector.py', [Path(r['path']).name for r in verify_v3()])

    def test_v3_selector_contract_unchanged(self):
        self.assertIn('selector-contract.json', [Path(r['path']).name for r in verify_v3()])

    def test_v3_scorer_contract_unchanged(self):
        self.assertIn('scorer-contract.json', [Path(r['path']).name for r in verify_v3()])

    def test_v3_eligibility_dependency_verified_but_not_reused(self):
        self.assertIn('eligibility.py', [Path(r['path']).name for r in verify_v3()])

    def test_h_and_missing_family_contract_fixed(self):
        self.assertEqual(read(HERE / 'source-policy.json')['HMs'], 50)
        self.assertEqual(read(HERE / 'discovery-contract.json')['requiredMissingFamilies'], list(MISSING))

    def test_only_gap_fill_allowed(self):
        selected = {key: {'family': key} for key in MISSING}
        self.assertEqual(gap_fill(selected), selected)

    def test_no_replace_vienna_single(self):
        with self.assertRaisesRegex(ValueError, 'CANNOT_REPLACE'):
            gap_fill({'correct_single': {}})

    def test_no_replace_vienna_chord_sustain(self):
        with self.assertRaisesRegex(ValueError, 'CANNOT_REPLACE'):
            gap_fill({'same_chord_sustain': {}})

    def test_batik_cannot_parse_without_remote_proof(self):
        freeze = {'files': []}
        freeze['freezeCanonicalSha256'] = sha256(canonical(freeze)).hexdigest()
        with self.assertRaisesRegex(ValueError, 'PROSPECTIVE_REMOTE_PROOF'):
            require_remote_proof(freeze, {}, '2026-10-18T12:00:00+00:00')

    def test_equality_verification_time_not_prospective(self):
        freeze = {'files': []}
        freeze['freezeCanonicalSha256'] = sha256(canonical(freeze)).hexdigest()
        proof = dict(remoteHead='x', freezeCommit='x', freezeSha256=freeze['freezeCanonicalSha256'],
                     remoteVerifiedAt='2026-10-18T12:00:00+00:00')
        with self.assertRaisesRegex(ValueError, 'PROSPECTIVE_REMOTE_PROOF'):
            require_remote_proof(freeze, proof, proof['remoteVerifiedAt'])

    def test_batik_scope_not_audio_or_other_corpus(self):
        scope = read(HERE / 'source-policy.json')['externalScope']
        self.assertEqual(scope['dataset'], 'batik')
        self.assertFalse(any('/audio/' in p for p in scope['allowedDownloads']))


if __name__ == '__main__':
    unittest.main()
