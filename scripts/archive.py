"""Archive tested portable applications and record the exact source revision.

Every name comes from the app's name file (core/app-name.json): the folders, archives and executables are named after
its id, the release notes after its name. `--dry-run` prints those names and the release notes as JSON without
reading or writing release/.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# What changed in this release (the same whatever the app is called).
CHANGES = """## 주요 변경

- LLM 연결: ChatGPT 계정 외에 API 키(OpenAI·Claude·Gemini)와 로컬 LLM(Ollama, OpenAI 호환)을 연결하고, 연결·모델을 골라 번역과 AI 도우미에 사용.
- 번역: 저장소별 번역 요청 사항(규칙)과 용어집, 페이지 재번역에서 다른 연결·모델 선택, 재시도 원인 표시. 원문 배치를 지키는 번역 조판(수식·표·참고문헌·다단 처리) 개선.
- 메모: 여러 메모와 제목, Markdown·LaTeX(KaTeX) 줄 안 라이브 렌더링(글머리·번호·할 일 목록 포함, Enter로 목록 이어 쓰기), 그림 붙여넣기, 그림 설명·AI 설명의 원문 쪽 연결. 고른 메모만 펼치고 높이 조절·넓은 편집기 제공.
- AI 도우미: 근거 쪽이 달린 구조화 요약·선택 설명·질문과 여러 자료 비교. 결과는 메모처럼 접힌 카드로 보이고 크게 보기 가능.
- 리더: 문장 선택 시 밑줄·하이라이트·주석 도구 막대와 단축키(U·H·N), 지우개로 밑줄 지우기, 주석 추가·그림 설명을 PDF 도구 줄에서 바로 사용. 펜·형광펜·도형 색은 `+`의 색 패널에서 더하고(형광펜은 종이 위에서 파스텔로 보이는 색), 텍스트 상자에 배경·테두리, PageUp/PageDown·방향키로 스크롤.
- 저장소 사이: 고른 자료나 저장소 전체를 이 PC의 다른 저장소로 복사·이동(메모·주석·필기·번역·노트북 포함, 받는 폴더와 폴더 구조 선택).
- 노트북: 원문 옆 노트북에 출처 카드·그림으로 넣기·텍스트 상자 서식, 새 메모를 만들어 바로 넣기, 페이지 크기(사용자 지정 포함)와 다른 PDF 쪽 가져오기, 모든 필기 도구 사용.
- 라이브러리: 저장소 전체 태그·컬렉션, 폴더·문서 이름 바꾸기, 상단 검색 결과 미리보기, 읽기 진행률과 자동 읽기 상태, DOI로 서지 채우기, PDF 포함 전체 백업, 공유 폴더 동기화.
- 모양: 사용자 CSS 테마·스니펫, 밝게·어둡게 전환.

기존 번역에 새 번역 지침을 적용하려면 `다시 번역`을 눌러주세요. 그림 설명에는 이미지 입력을 지원하는 모델이 필요합니다.

## 검증 범위

단위 테스트와 패키징된 Linux 앱 통합 시험을 수행했습니다. LLM 인증·추론은 시험 토큰과 모의 응답으로 검증했으며, 실제 계정·API 키·로컬 모델의 사용량·번역 속도·정확도 및 Windows 실행은 별도 확인이 필요합니다. Windows와 Linux x64 포터블 배포판이며 코드 서명·설치 마법사·자동 업데이트는 포함하지 않습니다.

글자층이 없는 쪽(스캔·그림으로 내보낸 슬라이드)은 로컬 OCR(영어)로 읽습니다. 수식·표·그림 안의 글자는 다시 조판하지 않고 원문 그대로 둡니다. 여러 PC 동기화는 공유 폴더(Google Drive·Dropbox 등의 PC 폴더)를 거치며, 클라우드 서비스에 직접 연결하지는 않습니다. 인증 토큰과 API 키는 OS 보안 저장소를 사용하고, 보안 저장소가 없으면 이번 실행 중에만 유지합니다.
"""


def app_name(root=ROOT):
    """The name file's values; without a name and an id of lower-case letters and digits there is no release."""
    name = json.loads((root / 'core' / 'app-name.json').read_text(encoding='utf-8'))
    if not name.get('name') or not re.fullmatch(r'[a-z][a-z0-9]*', name.get('id') or ''):
        raise SystemExit('core/app-name.json: a name and an id (lower-case letters and digits) are needed')
    return name


def names(name, version):
    """The packaged folders, the archives, the executables and the app's own licence beside them."""
    app_id = name['id']
    return {
        'targets': [f'{app_id}-win32-x64', f'{app_id}-linux-x64'],
        'windows': f'{app_id}-{version}-windows-x64.zip',
        'linux': f'{app_id}-{version}-linux-x64.tar.gz',
        'executables': {'windows': f'{app_id}.exe', 'linux': app_id},
        'licence': f'LICENSE-{app_id.upper()}.txt',
    }


def name_change(name, root=ROOT):
    """The "name changed" section, docs/release/name-change.md filled from the name file; nothing once it is gone."""
    file = root / 'docs' / 'release' / 'name-change.md'
    if not file.exists():
        return ''
    text = re.sub(r'<!--.*?-->\s*', '', file.read_text(encoding='utf-8'), flags=re.S).strip()
    values = {'name': name['name'], 'previous': ', '.join(h['name'] for h in name.get('history', [])), 'citekeyPrefix': name['citekeyPrefix']}
    return re.sub(r'\{(name|previous|citekeyPrefix)\}', lambda m: values[m.group(1)], text) + '\n\n'


def release_notes(name, version, commit, root=ROOT):
    n = names(name, version)
    return (f"""{name['name']} {version} · source `{commit}`

라이선스: AGPL-3.0-only (압축을 푼 폴더의 `{n['licence']}`). 이 판의 소스 코드는 이 릴리스의 태그(위 커밋)에서 받을 수 있습니다.

## 다운로드 및 실행

- Windows: `{n['windows']}` 전체 압축을 풀고 폴더 안의 `{n['executables']['windows']}`를 실행하세요.
- Linux: `{n['linux']}` 전체 압축을 풀고 폴더 안의 `{n['executables']['linux']}`를 실행하세요.
- `SHA256SUMS.txt`에서 파일 무결성을 확인할 수 있습니다. 실행 파일과 나머지 폴더를 함께 유지하세요.

""" + name_change(name, root) + CHANGES)


def main(root=ROOT):
    release = root / 'release'
    name = app_name(root)
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    n = names(name, version)
    if '--dry-run' in sys.argv:
        try:
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            commit = 'HEAD'
        print(json.dumps({**n, 'notes': release_notes(name, version, commit, root)}, ensure_ascii=False))
        return
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    for target in n['targets']:
        # Licence terms travel with the app: the app's own (AGPL-3.0, under its own name: the folder's
        # LICENSE is Electron's and must stay) and the third-party notices.
        for source, packaged in [('LICENSE', n['licence']), ('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'), ('COMMERCIAL.md', 'COMMERCIAL.md')]:
            if (root / source).exists():
                shutil.copyfile(root / source, release / target / packaged)
        (release / target / 'BUILD-INFO.json').write_text(json.dumps({
            'version': version, 'commit': commit, 'target': target,
            'license': 'AGPL-3.0-only', 'source': 'the repository this release belongs to, at the commit above',
            'translation': 'translation through a ChatGPT account, API keys (OpenAI, Claude, Gemini) or a local LLM',
            # What was checked for this build, as the release step says (APP_RELEASE_VERIFICATION), not a fixed claim.
            'verification': os.environ.get('APP_RELEASE_VERIFICATION', 'not recorded for this build'),
        }, indent=2) + '\n')

    windows, linux = release / n['windows'], release / n['linux']
    windows_target, linux_target = n['targets']
    with zipfile.ZipFile(windows, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted((release / windows_target).rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(release))
    with tarfile.open(linux, 'w:gz', compresslevel=6) as archive:
        archive.add(release / linux_target, arcname=linux_target)

    checksums = []
    for file in [windows, linux]:
        with file.open('rb') as stream:
            checksums.append(f'{hashlib.file_digest(stream, "sha256").hexdigest()}  {file.name}')
    (release / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
    (release / 'RELEASE-NOTES.md').write_text(release_notes(name, version, commit, root), encoding='utf-8')
    print(f'Archived {windows.name}, {linux.name}, and SHA256SUMS.txt')


if __name__ == '__main__':
    main()
