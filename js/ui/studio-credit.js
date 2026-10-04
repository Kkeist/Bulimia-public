// 设置页「显示设置」底部的工作室署名。文案只放在这里。目前界面只有中文，链接指向中文个人站。
const STUDIO_CREDIT = {
    by: I18n.t('哐哐哐況 制作。'),
    same: I18n.t('全网同名，更多好玩的请前往→'),
    link: I18n.t('哐哐的个人站。'),
    url: 'https://kb.kkeist.com/',
    avatar: 'icons/kk-avatar.png'
};

(function mountStudioCredit() {
    const root = document.getElementById('studio-credit');
    if (!root) return;
    const img = document.createElement('img');
    img.className = 'studio-credit-avatar';
    img.src = STUDIO_CREDIT.avatar;
    img.width = 48;
    img.height = 48;
    img.alt = '';
    const text = document.createElement('div');
    text.className = 'studio-credit-text';
    const line1 = document.createElement('div');
    line1.textContent = STUDIO_CREDIT.by;
    const line2 = document.createElement('div');
    line2.className = 'studio-credit-line';
    const same = document.createElement('span');
    same.textContent = STUDIO_CREDIT.same;
    const link = document.createElement('a');
    link.href = STUDIO_CREDIT.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = STUDIO_CREDIT.link;
    line2.append(same, link);
    text.append(line1, line2);
    root.append(img, text);
})();
