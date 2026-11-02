import argparse
import os
from pathlib import Path
from .store import Store


def main():
    parser=argparse.ArgumentParser(description='知习 · 内容工作台')
    parser.add_argument('command',choices=['serve','pause','status'],nargs='?',default='serve')
    parser.add_argument('--data',type=Path,default=Path(__file__).parent.parent/'.runtime')
    parser.add_argument('--port',type=int,default=8877)
    args=parser.parse_args();os.umask(0o077)
    if args.command=='serve':
        import uvicorn
        from .server import create_app
        uvicorn.run(create_app(args.data),host='127.0.0.1',port=args.port,access_log=False)
    else:
        db=Store(args.data)
        if args.command=='pause':db.set_enabled(False)
        print('自动运营：'+('运行中' if db.settings()['enabled'] else '已暂停'))
        print('稿件：'+str(len(db.drafts()))+'；队列：'+str(len(db.jobs())))

if __name__=='__main__':main()
