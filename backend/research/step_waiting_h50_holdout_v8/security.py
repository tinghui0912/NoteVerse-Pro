"""Audit processes cannot spawn a browser/runtime or import inference/audio SDKs."""
import os
import sys

FORBIDDEN_MODULES={'onnxruntime','torch','tensorflow','soundfile','librosa','scipy','numpy','playwright','selenium'}


def guard(event, args):
    if event=='import' and args[0].split('.')[0] in FORBIDDEN_MODULES:
        raise PermissionError('AUDIT_ONLY_RUNTIME_IMPORT_DENIED')
    if event=='subprocess.Popen' and os.path.basename(str(args[0])).lower() not in ('git','git.exe'):
        raise PermissionError('AUDIT_ONLY_NON_GIT_PROCESS_DENIED')
    if event in ('os.system','os.exec','os.posix_spawn'):
        raise PermissionError('AUDIT_ONLY_EXECUTION_DENIED')


sys.addaudithook(guard)
