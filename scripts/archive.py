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
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# What changed in this release (the same whatever the app is called).
CHANGES = """## 1.1.7에서 달라진 것

- macOS용을 **베타**로 처음 냅니다(Apple 실리콘 · 인텔). 자동 시험은 맥 빌드 서버에서 통과했지만 실제 맥에서 사람이 써 본 적이 없고, Apple 서명·공증이 없어 처음 열 때 경고가 뜹니다. 문제를 겪으면 이슈로 알려 주세요.
- 노트북의 펜 선 · 도형 · 텍스트 상자를 끌어 왼쪽 PDF 위에 놓으면 그 쪽의 필기가 됩니다(1.1.5의 PDF → 노트북의 반대 방향). 메모 카드 · 그림 · 출처 카드는 노트북에 남습니다.
- 글자를 고르면 뜨는 막대에서 `밑줄 긋기`와 `하이라이트`의 색이 아이콘(U · A 아래의 막대)에 보입니다. 아이콘을 누르면 색을 고르고, 글자를 누르면 지금 색으로 바로 긋습니다. 따로 있던 색 점은 없앴습니다.
- 고른 펜 선 · 도형 · 텍스트 상자를 `Ctrl+C`로 복사해 `Ctrl+V`로 붙여 넣습니다. 포인터가 있는 PDF 쪽이나 노트북 쪽에 붙고, PDF와 노트북 사이에서도 됩니다.
- 노트북의 `노트북 저장됨` 표시를 없앴습니다. 저장 중과 저장 실패만 알립니다.
- 고친 것: 텍스트 상자 · 펜 선 · 도형을 끌기 시작할 때와 놓을 때 화면이 잠깐 멈추던 것. 노트북으로 옮겼다 되돌린 텍스트 상자의 오른쪽에 빈 자리가 생기던 것.

## 1.1.6에서 달라진 것

- 고친 것: 텍스트 상자 · 펜 선 · 도형 · 올가미 선택을 끌어 옮길 때 움직임이 굼뜨던 것(1.1.5에서 생긴 문제). 끄는 동안 포인터 아래 창을 찾는 방식이 무거웠습니다.

## 1.1.5에서 달라진 것

- 필기를 옆 창으로 끌어 옮깁니다. 동시보기에서는 원문의 펜 선 · 도형 · 텍스트 상자를 끌어 번역 쪽에 놓으면 그쪽으로 옮겨지고(반대로도 됩니다), 노트북 화면에서는 왼쪽 PDF의 펜 선 · 도형 · 텍스트 상자를 노트북 종이에 놓을 수 있습니다. 실행 취소 한 번으로 양쪽이 함께 돌아옵니다.
- 고친 것: 색 줄 끝의 `+`를 누르면 색 견본이 한 줄로 길게 늘어서 창 밖까지 나가던 것(1.1.4에서 생긴 문제).

## 1.1.4에서 달라진 것

- 글자를 고르면 뜨는 막대에서 밑줄과 하이라이트의 색을 고릅니다. `밑줄 긋기` · `하이라이트` 옆의 색 점을 누르면 도구 줄의 펜 · 형광펜 색이 열리고, 고른 색으로 바로 그어지며 그 도구의 색으로 남습니다.
- 상단 막대 양쪽 끝의 사이드바 단추가 사이드바가 열려 있어도 늘 그 자리에 있습니다. 누르면 그쪽 사이드바가 닫히거나 열립니다.
- 고친 것: 영어 화면의 좁은 창에서 숨겨 둔 번역 결과 숫자가 잘린 글자로 남던 것.

## 1.1.3에서 달라진 것

- 강의 슬라이드 번역: "(2, 9) reaches r = 1."처럼 간단한 식이 든 문장이 수식으로 분류되어 영어로 남고 문단이 끊기던 것을 고쳤습니다. 가운데 정렬된 두 줄 문장은 한 문단으로, 코드 상자의 주석과 docstring은 줄마다 따로, 표의 칸은 머리글과 따로 번역합니다. 이미 번역한 쪽은 `이 페이지 다시 번역`을 눌러야 새 방식이 적용됩니다.
- 번역 쪽 위에 뜨던 `원문 유지 N개 · 사유` 안내를 없앴습니다(작은 쪽을 크게 볼 때 본문을 가렸습니다). 원문으로 둔 문단에 마우스를 올리면 번역이 열리는 것은 그대로입니다.
- `이 페이지 다시 번역`은 쪽 오른쪽 아래의 작은 표시가 되어, 그 표시에 마우스를 올릴 때만 단추로 펼쳐집니다. 쪽 크기나 배율과 관계없이 같은 크기입니다.
- 번역 도구 줄의 `번역됨 · 검토 필요 · 원문 유지 · 미번역` 숫자는 `번역 결과 상태` 단추의 풍선말과 창으로 옮겼습니다. 미번역이나 검토 필요가 있으면 단추에 빨간 점이 붙습니다.
- 고친 것: 여러 줄을 골라 밑줄을 그으면 첫 줄과 마지막 줄을 뺀 줄마다 밑줄이 두 줄씩 그어지던 문제(화면 · PDF 저장 · 인쇄). 이미 그은 밑줄도 한 줄로 보입니다.
- 새 버전 알림: 하루에 한 번이 아니라 앱을 켤 때마다(30분 안에 다시 켠 경우 제외), 켜 둔 동안에는 6시간마다 확인합니다. 설정 → 일반의 `지금 확인`으로 바로 확인할 수 있고, `나중에`로 미룬 알림은 다음에 켤 때 다시 나옵니다.

## 1.1.2에서 달라진 것

- 요약 탭의 `구조화 요약`을 `AI 요약`으로 이름을 바꿨습니다(연구 질문 · 방법 · 결과 · 한계로 나눠 요약하는 기능은 같습니다). 메모에 넣을 때의 머리말도 `[AI 요약 · 모델 · 날짜]`가 되고, 예전 머리말이 붙은 메모는 그대로 읽힙니다.

## 1.1.1에서 달라진 것

- 선택 도구(예전 이름 `읽기`)로 펜 선 · 도형 · 텍스트 상자를 바로 끌어 옮깁니다. 누르기만 하면 선택되어 복제 · 삭제 막대가 나오고, 색을 누르면 그 색으로 바뀝니다. 형광펜과 문장 형광 · 밑줄은 그 위에서 글자를 고를 수 있도록 지금처럼 올가미로 고른 뒤 옮깁니다.
- 올가미로 고른 묶음은 선택 도구로 바꿔도 남아, 그 안의 선 하나를 끌면 함께 옮겨집니다. 선택은 창 전체에서 하나라 Delete는 마지막에 고른 것만 지웁니다.
- 고친 것: 올가미로 고른 필기 · 텍스트 상자를 다른 쪽으로 끌어 놓으면 원래 쪽 바깥으로 옮겨져 보이지 않던 문제. 이제 놓은 쪽으로 옮겨지고 그 쪽 안에 들어가며, 끄는 동안에도 내용이 보입니다(원문 · 번역 · 노트북, 실행 취소 한 번에 되돌아옴).

## 1.1.0에서 달라진 것

- 처음 실행할 때 화면 언어(한국어 · English)를 한 번 묻고, 시작 화면 오른쪽 위의 버튼으로 언제든 바꿉니다.
- 서지정보의 `제목으로 파일 이름`: 자료의 PDF 파일 이름을 `제목.pdf`로 바꿉니다(메모·번역·필기 연결은 그대로).
- AI 질문을 Enter로 보냅니다. 줄바꿈은 Shift+Enter입니다.
- 열어 둔 저장소의 폴더 이름을 바꾸거나 옮겼을 때: "다른 프로그램에서 변경"이 아니라 폴더를 찾을 수 없다고 알리고, `폴더 다시 고르기`로 재시작 없이 이어서 씁니다.
- Ubuntu·Debian용 설치 패키지(`.deb`): 설치하면 앱 목록에 아이콘과 함께 등록됩니다.
- 새 버전 알림: 시작할 때 하루에 한 번까지 새 릴리스가 있는지 확인해 알립니다(설정 → 일반에서 끌 수 있고, 설치는 하지 않습니다).

## 주요 기능

- LLM 연결: ChatGPT 계정 외에 API 키(OpenAI·Claude·Gemini)와 로컬 LLM(Ollama, OpenAI 호환)을 연결하고, 연결·모델을 골라 번역과 AI 도우미에 사용.
- 번역: 저장소별 번역 요청 사항(규칙)과 용어집, 페이지 재번역에서 다른 연결·모델 선택, 재시도 원인 표시. 원문 배치를 지키는 번역 조판(수식·표·참고문헌·다단 처리) 개선.
- 메모: 여러 메모와 제목, Markdown·LaTeX(KaTeX) 줄 안 라이브 렌더링(글머리·번호·할 일 목록 포함, Enter로 목록 이어 쓰기), 그림 붙여넣기, 그림 설명·AI 설명의 원문 쪽 연결. 고른 메모만 펼치고 높이 조절·넓은 편집기 제공.
- AI 도우미: 근거 쪽이 달린 AI 요약·선택 설명·질문과 여러 자료 비교. 결과는 메모처럼 접힌 카드로 보이고 크게 보기 가능.
- 리더: 문장 선택 시 밑줄·하이라이트·주석 도구 막대와 단축키(U·H·N), 지우개로 밑줄 지우기, 주석 추가·그림 설명을 PDF 도구 줄에서 바로 사용. 펜·형광펜·도형 색은 `+`의 색 패널에서 더하고(형광펜은 종이 위에서 파스텔로 보이는 색), 텍스트 상자에 배경·테두리, PageUp/PageDown·방향키로 스크롤.
- 저장소 사이: 고른 자료나 저장소 전체를 이 PC의 다른 저장소로 복사·이동(메모·주석·필기·번역·노트북 포함, 받는 폴더와 폴더 구조 선택).
- 노트북: 원문 옆 노트북에 출처 카드·그림으로 넣기·텍스트 상자 서식, 새 메모를 만들어 바로 넣기, 페이지 크기(사용자 지정 포함)와 다른 PDF 쪽 가져오기, 모든 필기 도구 사용.
- 라이브러리: 저장소 전체 태그·컬렉션, 폴더·문서 이름 바꾸기, 상단 검색 결과 미리보기, 읽기 진행률과 자동 읽기 상태, DOI로 서지 채우기, PDF 포함 전체 백업, 공유 폴더 동기화.
- 모양: 사용자 CSS 테마·스니펫, 밝게·어둡게 전환.

기존 번역에 새 번역 지침을 적용하려면 `다시 번역`을 눌러주세요. 그림 설명에는 이미지 입력을 지원하는 모델이 필요합니다.

## 검증 범위

단위 테스트와 패키징된 Linux 앱 통합 시험, Debian 패키지의 설치·덮어 설치·제거(Ubuntu 24.04)를 수행했습니다. LLM 인증·추론은 시험 토큰과 모의 응답으로 검증했으며, 실제 계정·API 키·로컬 모델의 사용량·번역 속도·정확도 및 Windows 실행은 별도 확인이 필요합니다. macOS용(베타)은 맥 빌드 서버에서 패키징된 앱의 기본 화면 시험을 통과한 것이며, 실제 맥에서의 사용은 확인되지 않았습니다. Windows·Linux x64 포터블 배포판과 Ubuntu·Debian 설치 패키지이며, 코드 서명·Windows 설치 마법사·자동 업데이트는 포함하지 않습니다.

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
        'deb': f'{app_id}_{version}_amd64.deb',
        'executables': {'windows': f'{app_id}.exe', 'linux': app_id},
        'licence': f'LICENSE-{app_id.upper()}.txt',
    }


# What the app needs on a Debian or Ubuntu desktop. The libraries Ubuntu 24.04 renamed (…t64) are given with both names.
DEB_DEPENDS = ('libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, '
               'libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64')
DEB_ICON_SIZES = (16, 24, 32, 48, 64, 128, 256, 512)
# The address the Debian package gives for its maintainer (a package must name one): the project's GitHub address.
DEB_MAINTAINER_ADDRESS = '126231346+abc-engineer@users.noreply.github.com'


def package_json(root=ROOT):
    return json.loads((root / 'package.json').read_text(encoding='utf-8'))


def deb_control(name, version, pkg, size_kib=0):
    """DEBIAN/control: the package as apt and the software centre show it."""
    maintainer = (name.get('store') or {}).get('publisherDisplayName') or name['product']
    homepage = re.sub(r'\.git$', '', (pkg.get('repository') or {}).get('url', ''))
    lines = [f"Package: {name['id']}", f'Version: {version}', 'Architecture: amd64',
             f'Maintainer: {maintainer} <{DEB_MAINTAINER_ADDRESS}>', f'Installed-Size: {size_kib}',
             f'Depends: {DEB_DEPENDS}', 'Section: science', 'Priority: optional']
    if homepage:
        lines.append(f'Homepage: {homepage}')
    lines.append(f"Description: {pkg.get('description') or name['name']}")
    return '\n'.join(lines) + '\n'


def desktop_entry(name, pkg):
    """The entry that puts the app in the applications list, with its icon. (It does not offer the app for PDFs:
    the app does not open a file it is started with.)"""
    app_id = name['id']
    return '\n'.join(['[Desktop Entry]', 'Type=Application', f"Name={name['name']}",
                      f"Comment={pkg.get('description') or name['name']}", f'Exec=/opt/{app_id}/{app_id}',
                      f'Icon={app_id}', 'Terminal=false', 'Categories=Office;',
                      f"StartupWMClass={name['product']}"]) + '\n'


def build_deb(root, release, name, version, n):
    """The Linux folder as a Debian package: /opt/<id>, a launcher in /usr/bin, the desktop entry and the icons.
    Nothing is made where dpkg-deb is not there (a release made on Windows); the tarball stands either way."""
    if not shutil.which('dpkg-deb'):
        print('dpkg-deb is not here: no Debian package was made')
        return None
    app_id, pkg, source = name['id'], package_json(root), release / n['targets'][1]
    with tempfile.TemporaryDirectory() as temp:
        tree = Path(temp) / 'deb'
        shutil.copytree(source, tree / 'opt' / app_id, symlinks=True)
        (tree / 'usr' / 'bin').mkdir(parents=True)
        (tree / 'usr' / 'bin' / app_id).symlink_to(f'/opt/{app_id}/{app_id}')
        applications = tree / 'usr' / 'share' / 'applications'
        applications.mkdir(parents=True)
        (applications / f'{app_id}.desktop').write_text(desktop_entry(name, pkg), encoding='utf-8')
        for size in DEB_ICON_SIZES:
            icon = root / 'brand' / 'png' / f'{app_id}-icon-{size}.png'
            if icon.exists():
                place = tree / 'usr' / 'share' / 'icons' / 'hicolor' / f'{size}x{size}' / 'apps'
                place.mkdir(parents=True)
                shutil.copyfile(icon, place / f'{app_id}.png')
        doc = tree / 'usr' / 'share' / 'doc' / app_id
        doc.mkdir(parents=True)
        shutil.copyfile(root / 'LICENSE', doc / 'copyright')
        size_kib = sum(f.lstat().st_size for f in tree.rglob('*') if f.is_file() or f.is_symlink()) // 1024
        debian = tree / 'DEBIAN'
        debian.mkdir()
        (debian / 'control').write_text(deb_control(name, version, pkg, size_kib), encoding='utf-8')
        # Chromium's sandbox helper must be set-uid root; the lists of applications and icons are read again.
        refresh = ('if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q || true; fi\n'
                   'if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi\n')
        scripts = {'postinst': f'#!/bin/sh\nset -e\nchmod 4755 /opt/{app_id}/chrome-sandbox\n{refresh}', 'postrm': f'#!/bin/sh\nset -e\n{refresh}'}
        for script, text in scripts.items():
            (debian / script).write_text(text, encoding='utf-8')
            (debian / script).chmod(0o755)
        # The same modes whatever the builder's umask: folders and what can be run 755, the rest 644.
        tree.chmod(0o755)
        for entry in tree.rglob('*'):
            if entry.is_symlink():
                continue
            entry.chmod(0o755 if entry.is_dir() or entry.stat().st_mode & 0o111 else 0o644)
        target = release / n['deb']
        # xz, which every dpkg reads (Ubuntu's own default, zstd, is not read by Debian 11 and earlier).
        subprocess.check_call(['dpkg-deb', '-Zxz', '--build', '--root-owner-group', str(tree), str(target)], stdout=subprocess.DEVNULL)
    return target


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
- Ubuntu·Debian: `{n['deb']}`를 받아 `sudo apt install ./{n['deb']}`로 설치하면 앱 목록에 등록됩니다.
- macOS(베타): Apple 실리콘은 `{name['id']}-{version}-macos-arm64.zip`, 인텔 맥은 `{name['id']}-{version}-macos-x64.zip`의 압축을 풀고 `{name['id']}.app`을 우클릭해 `열기`로 실행하세요. Apple 서명·공증이 없어 처음 열 때 경고가 뜹니다. "손상되었다"고 나오면 터미널에서 `xattr -cr <앱 경로>`를 한 번 실행하세요. 이 파일은 릴리스가 만들어진 몇 분 뒤에 붙고, 무결성은 `SHA256SUMS-macos.txt`로 확인합니다.
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
        pkg = package_json(root)
        print(json.dumps({**n, 'notes': release_notes(name, version, commit, root), 'control': deb_control(name, version, pkg), 'desktop': desktop_entry(name, pkg)}, ensure_ascii=False))
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

    deb = build_deb(root, release, name, version, n)
    checksums = []
    for file in [windows, linux, *([deb] if deb else [])]:
        with file.open('rb') as stream:
            checksums.append(f'{hashlib.file_digest(stream, "sha256").hexdigest()}  {file.name}')
    (release / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
    (release / 'RELEASE-NOTES.md').write_text(release_notes(name, version, commit, root), encoding='utf-8')
    print(f'Archived {windows.name}, {linux.name}{", " + deb.name if deb else ""}, and SHA256SUMS.txt')


if __name__ == '__main__':
    main()
