import os
import tempfile
# Installed before collection imports backend.store, including single-file runs.
os.environ['MVC_DATA_DIR']=tempfile.mkdtemp(prefix='mvc-tests-')
