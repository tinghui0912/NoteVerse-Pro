"""Persist complete focused-test output before the source-discovery freeze."""
from datetime import datetime, timezone
from hashlib import sha256
import io
import sys
import unittest
from contracts import HERE, OUT, save


def main():
    suffix = sys.argv[1] if len(sys.argv) > 1 else ''
    if suffix not in ('', '-complete', '-freeze', '-final', '-discovery', '-scope', '-review'):
        raise ValueError('INVALID_TEST_ARTIFACT_SUFFIX')
    started = datetime.now(timezone.utc).isoformat()
    suite = unittest.defaultTestLoader.discover(str(HERE), pattern='test_*.py')
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    text = stream.getvalue()
    with (OUT / ('focused-tests' + suffix + '.txt')).open('x', encoding='utf-8', newline='\n') as file:
        file.write(text)
    report = {'executionStartedAt': started, 'completedAt': datetime.now(timezone.utc).isoformat(),
              'testFiles': len(list(HERE.glob('test_*.py'))), 'tests': result.testsRun,
              'passed': result.testsRun - len(result.failures) - len(result.errors),
              'failed': len(result.failures), 'errors': len(result.errors),
              'outputSha256': sha256(text.encode()).hexdigest(),
              'batikMidiEventsParsed': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0}
    save(OUT / ('focused-tests' + suffix + '.json'), report)
    print(text)
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
