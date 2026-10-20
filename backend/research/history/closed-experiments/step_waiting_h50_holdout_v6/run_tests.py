import io
import unittest
from contracts import *


def main():
    started=now(); stream=io.StringIO()
    result=unittest.TextTestRunner(stream=stream,verbosity=2).run(unittest.defaultTestLoader.discover(str(HERE),pattern='test_*.py'))
    text=stream.getvalue()
    with (OUT/'focused-tests.txt').open('x',encoding='utf-8',newline='\n') as file:file.write(text)
    save(OUT/'focused-tests.json',{'executionStartedAt':started,'completedAt':now(),'testFiles':2,'tests':result.testsRun,
        'passed':result.testsRun-len(result.failures)-len(result.errors),'failed':len(result.failures),'errors':len(result.errors),
        'outputSha256':digest(text.encode()),'newNeuralRuns':0,'selectedAudioDecoded':False})
    print(text)
    if not result.wasSuccessful():raise SystemExit(1)


if __name__=='__main__':main()
