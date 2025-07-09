// ==UserScript==
// @name         GitHub 中文化插件
// @namespace    https://github.com/maboloshi/github-chinese
// @description  中文化 GitHub 界面的部分菜单及内容。原作者为楼教主(http://www.52cik.com/)。
// @copyright    2021, 沙漠之子 (https://maboloshi.github.io/Blog)
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @version      1.9.4-2025-06-28
// @author       沙漠之子
// @license      GPL-3.0
// @match        https://github.com/*
// @match        https://skills.github.com/*
// @match        https://gist.github.com/*
// @match        https://education.github.com/*
// @match        https://www.githubstatus.com/*
// @require      https://raw.githubusercontent.com/maboloshi/github-chinese/gh-pages/locals.js?v1.9.4-2025-06-28
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @connect      fanyi.iflyrec.com
// @supportURL   https://github.com/maboloshi/github-chinese/issues
// ==/UserScript==

(function (window, document, undefined) {
    'use strict';

    /****************** 全局配置常量 ******************/
    const CONFIG = {
        LANG: 'zh-CN', // 默认语言
        CACHE_TTL: 24 * 60 * 60 * 1000, // 翻译缓存有效期（24小时）
        PAGE_MAP: { // 域名到页面类型的映射
            'gist.github.com': 'gist',
            'www.githubstatus.com': 'status',
            'skills.github.com': 'skills',
            'education.github.com': 'education'
        },
        SPECIAL_SITES: ['gist', 'status', 'skills', 'education'], // 特殊站点类型
        DESC_SELECTORS: { // 简介元素的CSS选择器
            repository: ".f4.my-3",
            gist: ".gist-content [itemprop='about']"
        },
        OBSERVER_CONFIG: { // MutationObserver配置
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['value', 'placeholder', 'aria-label', 'data-confirm']
        },
        TRANS_ENGINES: { // 翻译引擎配置
            iflyrec: {
                name: '讯飞听见',
                url: 'https://fanyi.iflyrec.com/text-translate',
                url_api: 'https://fanyi.iflyrec.com/TJHZTranslationService/v2/textAutoTranslation',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://fanyi.iflyrec.com'
                },
                getRequestData: (text) => ({
                    from: 2, // 英语
                    to: 1,   // 中文
                    type: 1,
                    contents: [{ text: text }]
                }),
                responseIdentifier: 'biz[0]?.sectionResult[0]?.dst', // 翻译结果在响应中的路径
            },
        },
        STYLES: ` /* 自定义样式 */
            .translate-button {
                color: #1b95e0;
                font-size: small;
                cursor: pointer;
                margin-top: 5px;
                display: inline-block;
            }
            .translation-result {
                margin-top: 10px;
                padding: 8px;
                background-color: #f8f9fa;
                border: 1px solid #e1e4e8;
                border-radius: 6px;
            }
            .translation-credit {
                font-size: small;
                color: #6a737d;
            }
            .translation-content {
                margin-top: 5px;
                white-space: pre-wrap;
            }
        `
    };

    /****************** 状态管理 ******************/
    const state = {
        featureSet: { // 功能开关状态
            enable_RegExp: GM_getValue("enable_RegExp", true),
            enable_transDesc: GM_getValue("enable_transDesc", true),
            enable_transCache: GM_getValue("enable_transCache", true),
            enable_missedTerms: GM_getValue("enable_missedTerms", false),
        },
        pageConfig: {}, // 当前页面配置
        transEngine: 'iflyrec', // 当前使用的翻译引擎
        mutationObserver: null, // DOM变化观察器
        transCache: new Map(), // 翻译结果缓存
        dynamicMenus: {},
        missedTerms: GM_getValue("missedTerms", {})
    };

    /****************** 核心功能函数 ******************/

    /**
     * 主初始化函数
     * 设置中文环境、注入样式、设置观察器等
     */
    function init() {
        initLangEnv();
        injectStyles();
        setupMenuCommands();
        setupInitTrans();
        setupTurboEvents();
    }

    /**
     * 初始化并保护中文语言环境
     * 1. 设置初始语言
     * 2. 监视语言属性变化，防止被改回英文
     */
    function initLangEnv() {
        // 设置初始语言
        document.documentElement.lang = CONFIG.LANG;

        // 监视语言属性变化，防止被改回英文
        const observer = new MutationObserver(() => {
            // 如果检测到语言被改回英文，重新设置
            if (document.documentElement.lang === "en") {
                document.documentElement.lang = CONFIG.LANG;
            }
        });
        observer.observe(document.documentElement, {
            attributeFilter: ['lang']
        });
    }

    /**
     * 注入自定义样式到页面
     */
    function injectStyles() {
        GM_addStyle(CONFIG.STYLES);
    }


    /**
     * 设置初始翻译
     * 在DOM加载完成后执行首次翻译
     */
    function setupInitTrans() {
        window.addEventListener('DOMContentLoaded', () => {
            updatePageConfig('首次载入');
            if (state.pageConfig.currentPageType) {
                traverseNode(document.body); // 遍历整个页面进行翻译
            }
            setupMutationObserver(); // 设置DOM变化观察器
        });
    }

    /**
     * 设置Turbo框架事件监听
     * 处理GitHub的Turbolinks页面切换
     */
    function setupTurboEvents() {
        document.addEventListener('turbo:load', handleTurboLoad);
    }

    /**
     * 处理Turbo页面加载事件
     * 在新页面加载后执行必要的翻译
     */
    function handleTurboLoad() {
        if (!state.pageConfig.currentPageType) return;

        transTitle(); // 翻译页面标题
        transBySelector(); // 通过选择器翻译特定元素

        // 如果描述翻译功能启用，翻译页面描述
        if (state.featureSet.enable_transDesc &&
            CONFIG.DESC_SELECTORS[state.pageConfig.currentPageType]) {
            transDesc(CONFIG.DESC_SELECTORS[state.pageConfig.currentPageType]);
        }
    }

    /****************** 页面配置管理函数 ******************/

    /**
     * 更新页面配置
     * @param {string} trigger - 触发更新的原因（用于调试）
     */
    function updatePageConfig(trigger) {
        const newType = detectPageType();
        if (newType && newType !== state.pageConfig.currentPageType) {
            state.pageConfig = buildPageConfig(newType);
            if (state.featureSet.enable_transCache) clearTransCache(); // 切换页面时清空缓存
        }
        console.log(`【Debug】${trigger}触发, 页面类型为 ${state.pageConfig.currentPageType}`);
    }

    /**
     * 构建页面配置对象
     * @param {string} pageType - 页面类型
     * @returns {Object} 页面配置对象
     */
    function buildPageConfig(pageType) {
        return {
            currentPageType: pageType, // 当前页面类型
            currentPath: window.location.pathname,
            staticDict: { // 合并公共和页面特定的静态词典
                ...I18N[CONFIG.LANG].public.static,
                ...(I18N[CONFIG.LANG][pageType]?.static || {})
            },
            regexpRules: [ // 合并公共和页面特定的正则规则
                ...(I18N[CONFIG.LANG][pageType]?.regexp || []),
                ...I18N[CONFIG.LANG].public.regexp
            ],
            ignoreMutationSelectors: [ // 忽略的突变选择器
                ...I18N.conf.ignoreMutationSelectorPage['*'],
                ...(I18N.conf.ignoreMutationSelectorPage[pageType] || [])
            ].join(', '),
            ignoreSelectors: [ // 忽略的选择器
                ...I18N.conf.ignoreSelectorPage['*'],
                ...(I18N.conf.ignoreSelectorPage[pageType] || [])
            ].join(', '),
            characterData: I18N.conf.characterDataPage.includes(pageType), // 是否监视文本节点变化
            tranSelectors: [ // 翻译选择器规则
                ...(I18N[CONFIG.LANG].public.selector || []),
                ...(I18N[CONFIG.LANG][pageType]?.selector || [])
            ],
        };
    }

    /****************** 页面类型检测函数 ******************/

    /**
     * 检测当前页面类型
     * @returns {string|boolean} 页面类型或false（如果未识别）
     */
    function detectPageType() {
        const url = new URL(window.location.href);
        const { PAGE_MAP, SPECIAL_SITES } = CONFIG;
        const { hostname, pathname } = url;

        // 基础配置
        const site = PAGE_MAP[hostname] || 'github'; // 通过站点映射获取基础类型
        const isLogin = document.body.classList.contains("logged-in");
        const metaLocation = document.head.querySelector('meta[name="analytics-location"]')?.content || '';

        // 页面特征检测
        const isSession = document.body.classList.contains("session-authentication");
        const isHomepage = pathname === '/' && site === 'github';
        const isProfile = document.body.classList.contains("page-profile") || metaLocation === '/<user-name>';
        const isRepository = /\/<user-name>\/<repo-name>/.test(metaLocation);
        const isOrganization = /\/<org-login>/.test(metaLocation) || /^\/(?:orgs|organizations)/.test(pathname);

        let pageType;
        // 根据页面特征确定页面类型
        switch (true) { // 使用 switch(true) 模式处理多条件分支
            case isSession: // 登录/认证页面
                pageType = 'session-authentication';
                break;
            case SPECIAL_SITES.includes(site): // 特殊站点
                pageType = site;
                break;
            case isProfile: // 用户资料页面
                const tabParam = new URLSearchParams(url.search).get('tab');
                pageType = pathname.includes('/stars') ? 'page-profile/stars'
                         : tabParam ? `page-profile/${tabParam}`
                         : 'page-profile';
                break;
            case isHomepage: // 首页/仪表盘
                pageType = isLogin ? 'dashboard' : 'homepage';
                break;
            case isRepository: // 代码仓库页面
                const repoMatch = pathname.match(I18N.conf.rePagePathRepo);
                pageType = repoMatch ? `repository/${repoMatch[1]}` : 'repository';
                break;
            case isOrganization: // 组织页面
                const orgMatch = pathname.match(I18N.conf.rePagePathOrg);
                pageType = orgMatch ? `orgs/${orgMatch[1] || orgMatch.slice(-1)[0]}` : 'orgs';
                break;
            default: // 默认页面类型
                const pathMatch = pathname.match(I18N.conf.rePagePath);
                pageType = pathMatch ? (pathMatch[1] || pathMatch.slice(-1)[0]) : false;
        }

        // 验证页面类型是否有效
        if (pageType === false || !I18N[CONFIG.LANG]?.[pageType]) {
            console.warn(`[i18n] 页面类型未匹配或词库缺失: ${pageType}`);
            return false;
        }

        return pageType;
    }

    /****************** DOM 操作与遍历函数 ******************/

    /**
     * 设置DOM变化观察器
     * 监听页面变化并触发翻译
     */
    function setupMutationObserver() {
        // 如果已有观察器，先断开
        if (state.mutationObserver) {
            state.mutationObserver.disconnect();
        }

        // 缓存当前页面的 URL
        let previousURL = window.location.href;

        // 创建新的MutationObserver
        state.mutationObserver = new MutationObserver(mutations => {
            const currentURL = window.location.href;
            // 检测URL变化
            if (currentURL !== previousURL) {
                previousURL = currentURL;
                updatePageConfig("URL变化");
            }

            // 处理DOM变化
            if (state.pageConfig.currentPageType) {
                processMutations(mutations);
            }
        });

        // 开始观察页面主体
        state.mutationObserver.observe(document.body, CONFIG.OBSERVER_CONFIG);
    }

    /**
     * 处理MutationObserver检测到的变化
     * @param {Array} mutations - 变化记录数组
     */
    function processMutations(mutations) {
        const nodesToProcess = new Set();

        // 收集需要处理的节点
        mutations.forEach(({ target, addedNodes, type }) => {
            if (type === 'childList' && addedNodes.length > 0) {
                // 处理新增节点
                addedNodes.forEach(node => {
                    if (!node.parentElement?.closest(state.pageConfig.ignoreMutationSelectors)) {
                        nodesToProcess.add(node);
                    }
                });
            }
            else if (type === 'attributes' ||
                    (type === 'characterData' && state.pageConfig.characterData)) {
                // 处理属性或文本变化
                if (!target.closest?.(state.pageConfig.ignoreMutationSelectors)) {
                    nodesToProcess.add(target);
                }
            }
        });

        // 遍历处理收集到的节点
        nodesToProcess.forEach(node => { traverseNode(node);});
    }

    /**
     * 遍历节点树并进行翻译
     * @param {Node} rootNode - 要遍历的根节点
     */
    function traverseNode(rootNode) {
        const start = performance.now();

        // 文本节点直接处理
        if (rootNode.nodeType === Node.TEXT_NODE) {
            handleTextNode(rootNode);
            return;
        }

        // 创建TreeWalker遍历节点树
        const treeWalker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            node => node.matches?.(state.pageConfig.ignoreSelectors)
                ? NodeFilter.FILTER_REJECT // 跳过忽略的选择器
                : NodeFilter.FILTER_ACCEPT // 接受其他节点
        );

        // 节点类型处理函数映射
        const handlers = {
            [Node.ELEMENT_NODE]: handleElementNode,
            [Node.TEXT_NODE]: handleTextNode
        };

        let currentNode;
        // 遍历所有节点
        while ((currentNode = treeWalker.nextNode())) {
            handlers[currentNode.nodeType]?.(currentNode);
        }

        // 性能监控
        const duration = performance.now() - start;
        if (duration > 10) {
            console.log(`节点遍历耗时: ${duration.toFixed(2)}ms`);
        }
    }

    /**
     * 处理文本节点
     * @param {Node} node - 文本节点
     */
    function handleTextNode(node) {
        if (node.length > 500) return; // 跳过长文本节点
        transElementAttrs(node, 'data'); // 翻译文本内容
    }

    /**
     * 处理元素节点
     * @param {Element} node - 元素节点
     */
    function handleElementNode(node) {
        // 根据标签类型进行不同的翻译处理
        switch (node.tagName) {
            case "RELATIVE-TIME": // 相对时间元素
                transTimeElement(node.shadowRoot);
                return;
            case "INPUT":
            case "TEXTAREA": // 输入框和文本域
                if (['button', 'submit', 'reset'].includes(node.type)) {
                    transElementAttrs(node.dataset, 'confirm'); // 确认对话框文本
                    transElementAttrs(node, 'value'); // 值属性
                } else {
                    transElementAttrs(node, 'placeholder'); // 占位符
                }
                break;
            case "OPTGROUP": // 选项组
                transElementAttrs(node, 'label'); // 标签文本
                break;
            case "BUTTON": // 按钮
                transElementAttrs(node, 'cancelConfirmText'); // 取消确认文本
                transElementAttrs(node.dataset, [
                    'confirm',  // 确认文本
                    'confirmText',  // 确认按钮文本
                    'confirmCancelText',  // 取消按钮文本
                    'disableWith' // 禁用提示
                ]);
                // 注意：这里没有break，会继续执行下面的case
            case "A":
            case "SPAN": // 链接和跨距
                transElementAttrs(node, 'title'); // 标题提示
                transElementAttrs(node.dataset, 'visibleText'); // 可见文本
                // 注意：这里没有break，会继续执行下面的case
            default:
                // 带有提示样式的元素
                if (/tooltipped/.test(node.className)) {
                    transElementAttrs(node, 'ariaLabel'); // ARIA标签
                }
        }
    }

    /****************** 翻译功能函数 ******************/

    /**
     * 翻译页面标题
     */
    function transTitle() {
        const text = document.title;
        let result = I18N[CONFIG.LANG]['title']['static'][text] || '';

        // 尝试静态翻译
        if (!result) {
            // 尝试正则表达式翻译
            for (const [pattern, replacement] of (I18N[CONFIG.LANG]['title'].regexp || [])) {
                result = text.replace(pattern, replacement);
                if (result !== text) break;
            }
        }

        // 应用翻译结果
        if (result) {
            document.title = result;
        }
    }

    /**
     * 翻译时间元素
     * @param {Element} element - 时间元素
     */
    function transTimeElement(element) {
        // 获取时间文本
        const text = element.textContent;
        // 移除开头的"on"
        const result = text.replace(/^on/, "");
        if (result !== text) {
            element.textContent = result; // 应用翻译
        }
    }

    /**
     * 批量翻译元素的多个属性
     * @param {Object} target - 元素对象或元素数据集
     * @param {string|string[]} attrs - 要翻译的属性名或属性名数组
     */
    function transElementAttrs(target, attrs) {
        const attrList = Array.isArray(attrs) ? attrs : [attrs];

        for (const attrName of attrList) {
            const text = target[attrName];
            if (!text) continue;

            const result = transText(text);
            if (result) {
                target[attrName] = result;
            }
        }
    }

    /**
     * 通过选择器翻译特定元素
     */
    function transBySelector() {
        state.pageConfig.tranSelectors?.forEach(([selector, result]) => {
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = result; // 应用翻译
            }
        });
    }

    /**
     * 翻译文本内容
     * @param {string} text - 要翻译的文本
     * @returns {string|boolean} 翻译后的文本或false（如果没有翻译）
     */
    function transText(text) {
        // 跳过不需要翻译的文本：
        // 1. 空文本（包空白字符）或纯数字
        // 2. 纯中文字符
        // 3. 不包含英文字母和,.符号的文本
        if (/^[\s0-9]*$/.test(text) ||
            /^[\u4e00-\u9fa5]+$/.test(text) ||
            !/[a-zA-Z,.]/.test(text)) {
            return false;
        }

        // 清理文本：去除首尾空格和多余空白
        const trimmedText = text.trim();
        const cleanedText = trimmedText.replace(/\xa0|[\s]+/g, ' ');

        // 检查缓存
        if (state.featureSet.enable_transCache && state.transCache.has(cleanedText)) {
            const cached = state.transCache.get(cleanedText);
            // 保留原始文本的空白格式
            return text.replace(trimmedText, cached);
        }

        // 获取翻译
        const result = fetchTransResult(cleanedText);
        if (result && result !== cleanedText) {
            // 缓存翻译结果
            if (state.featureSet.enable_transCache) state.transCache.set(cleanedText, result);
            return text.replace(trimmedText, result);
        }

        return false;
    }

    /**
     * 清空翻译缓存
     */
    function clearTransCache() {
        state.transCache.clear();
    }

    function clearMissedTerms() {
        state.missedTerms.clear();
        GM_setValue("missedTerms", state.missedTerms);
    }

    function cleanupMissedTerm(text) {
        if (state.missedTerms[state.pageConfig.currentPath]?.[text]) {
            delete state.missedTerms[state.pageConfig.currentPath][text];
            if (Object.keys(state.missedTerms[state.pageConfig.currentPath]).length === 0) {
                delete state.missedTerms[state.pageConfig.currentPath];
            }
            GM_setValue("missedTerms", state.missedTerms);
            refreshMenuStates();
        }
    }

    /**
     * 从词库获取翻译
     * @param {string} text - 要翻译的文本
     * @returns {string|boolean} 翻译结果或false
     */
    function fetchTransResult(text) {
        // 首先尝试静态词典
        const result = state.pageConfig.staticDict[text];
        if (result!== undefined && typeof result === 'string') {
            if (state.featureSet.enable_missedTerms) cleanupMissedTerm(text);
            return result;
        }

        // 如果正则功能启用，尝试正则规则
        if (state.featureSet.enable_RegExp) {
            for (const [pattern, replacement] of state.pageConfig.regexpRules) {
                const result = text.replace(pattern, replacement);
                if (result !== text) {
                    if (state.featureSet.enable_missedTerms) cleanupMissedTerm(text);
                    return result;
                }
            }
        }

        // 记录未命中词条（避免重复）（仅启用时）
        if (state.featureSet.enable_missedTerms) {
            state.missedTerms[state.pageConfig.currentPath] ||= {};
            if (!(text in state.missedTerms[state.pageConfig.currentPath])) {
                state.missedTerms[state.pageConfig.currentPath][text] = "";
                GM_setValue("missedTerms", state.missedTerms);
                refreshMenuStates(); // 动态更新菜单启用状态
            }
        }

        return false;
    }

    /****************** 远程翻译功能 ******************/

    /**
     * 为描述元素添加翻译按钮
     * @param {string} selector - 描述元素的选择器
     */
    function transDesc(selector) {
        const element = document.querySelector(selector);
        // 如果元素不存在或已有翻译按钮，则返回
        if (!element || element.nextElementSibling?.classList.contains('translate-button')) return;

        // 创建翻译按钮
        const button = document.createElement('div');
        button.classList.add('translate-button');
        button.textContent = '翻译';
        element.after(button);

        // 绑定点击事件
        button.addEventListener('click', () => handleTransClick(button, element));
    }

    /**
     * 处理翻译按钮点击事件
     * @param {Element} button - 翻译按钮元素
     * @param {Element} element - 要翻译的元素
     */
    function handleTransClick(button, element) {
        if (button.disabled) return;
        button.disabled = true; // 防止重复点击

        const descText = element.textContent.trim();
        if (!descText) {
            button.disabled = false;
            return;
        }

        // 检查缓存
        if (state.featureSet.enable_transCache && state.transCache.has(descText)) {
            showTransResult(element, button, state.transCache.get(descText));
            return;
        }

        // 发起远程翻译请求
        requestRemoteTrans(descText)
            .then(result => {
                // 缓存并显示结果
                if (state.featureSet.enable_transCache) state.transCache.set(descText, result);
                showTransResult(element, button, result);
            })
            .catch(error => {
                console.error('翻译失败:', error);
                button.disabled = false; // 启用按钮以允许重试
            });
    }

    /**
     * 显示翻译结果
     * @param {Element} element - 原始元素
     * @param {Element} button - 翻译按钮
     * @param {string} result - 翻译结果
     */
    function showTransResult(element, button, result) {
        const { name, url } = CONFIG.TRANS_ENGINES[state.transEngine];

        // 创建结果容器
        const resultContainer = document.createElement('div');
        resultContainer.className = 'translation-result';
        resultContainer.innerHTML = `
            <span class="translation-credit">
                由 <a target='_blank' href='${url}'>${name}</a> 翻译👇
            </span>
            <br/>
            <div class="translation-content">${result}</div>
        `;

        // 移除按钮并显示结果
        button.remove();
        element.after(resultContainer);
    }

    /**
     * 请求远程翻译API
     * @param {string} text - 要翻译的文本
     * @returns {Promise} 返回翻译结果的Promise
     */
    function requestRemoteTrans(text) {
        return new Promise((resolve, reject) => {
            const engineConfig = CONFIG.TRANS_ENGINES[state.transEngine];
            const { url_api, method, headers, getRequestData, responseIdentifier } = engineConfig;

            // 准备请求数据
            const requestData = getRequestData(text);

            // 使用GM_xmlhttpRequest发起跨域请求
            GM_xmlhttpRequest({
                method: method,
                url: url_api,
                headers: headers,
                data: method === 'POST' ? JSON.stringify(requestData) : null,
                params: method === 'GET' ? requestData : null, // For GET requests
                timeout: 10000, // 10秒超时
                onload: (res) => {
                    try {
                        const response = JSON.parse(res.responseText);
                        // 从响应中提取翻译结果
                        const result = getNestedProperty(response, responseIdentifier);
                        if (result) {
                            resolve(result);
                        } else {
                            reject(new Error('翻译结果无效'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                },
                onerror: (err) => {
                    reject(err);
                }
            });
        });
    }

    /**
     * 安全获取嵌套对象属性
     * @param {Object} obj - 目标对象
     * @param {string} path - 属性路径（如 'a.b[0].c'）
     * @returns {*} 属性值或undefined
     */
    function getNestedProperty(obj, path) {
        return path.split('.').reduce((acc, part) => {
            const match = part.match(/(\w+)(?:\[(\d+)\])?/);
            if (!match || !acc) return undefined;
            const key = match[1];
            const index = match[2];
            // 处理数组索引或对象属性
            return index !== undefined ? acc[key]?.[index] : acc[key];
        }, obj);
    }

    /****************** 用户菜单功能 ******************/

    /**
     * 设置用户脚本菜单命令
     */
    function setupMenuCommands() {
        const menuConfigs = [
            {
                label: "正则功能",
                key: "enable_RegExp",
                callback: newFeatureState => {
                    if (newFeatureState) traverseNode(document.body); // 重新遍历文档
                }
            },
            {
                label: "描述翻译",
                key: "enable_transDesc",
                callback: newFeatureState => {
                    if (newFeatureState && CONFIG.DESC_SELECTORS[state.pageConfig.currentPageType]) {
                        // 启用描述翻译
                        transDesc(CONFIG.DESC_SELECTORS[state.pageConfig.currentPageType]);
                    } else {
                        // 禁用描述翻译，移除按钮
                        document.querySelector('.translate-button')?.remove();
                    }
                }
            },
            {
                label: "翻译缓存",
                key: "enable_transCache"
            }
        ];

        // 为每个配置创建菜单命令
        menuConfigs.forEach(config => createMenuCommand(config));
        refreshMenuStates(); // 动态构建全部菜单
    }

    /**
     * 创建单个菜单命令
     * @param {Object} config - 菜单配置
     */
    function createMenuCommand(config) {
        const { label, key, callback } = config;
        let menuId;

        // 生成菜单标签（根据当前状态）
        const getMenuLabel = () =>
            `${state.featureSet[key] ? "禁用" : "启用"} ${label}`;

        // 切换功能状态
        const toggle = () => {
            const newFeatureState = !state.featureSet[key];
            // 保存到存储
            GM_setValue(key, newFeatureState);
            state.featureSet[key] = newFeatureState;
            // 显示通知
            GM_notification(`${label}已${newFeatureState ? '启用' : '禁用'}`);

            // 执行回调
            callback?.(newFeatureState);

            // 重新注册菜单（更新标签）
            GM_unregisterMenuCommand(menuId);
            menuId = GM_registerMenuCommand(getMenuLabel(), toggle);
        };

        // 初始注册菜单
        menuId = GM_registerMenuCommand(getMenuLabel(), toggle);
        refreshMenuStates(); // 动态构建全部菜单
    }

    function refreshMenuStates() {
        // 清除旧动态菜单
        Object.values(state.dynamicMenus).forEach(id => GM_unregisterMenuCommand(id));
        state.dynamicMenus = {};

        // 未命中词条开关
        const toggleLabel = `${state.featureSet.enable_missedTerms ? "禁用" : "启用"} 未命中词条记录`;
        state.dynamicMenus.toggle = GM_registerMenuCommand(toggleLabel, () => {
            const newFeatureState = !state.featureSet.enable_missedTerms;
            GM_setValue("enable_missedTerms", newFeatureState);
            state.featureSet.enable_missedTerms = newFeatureState;

            if (newFeatureState) {
                GM_notification("未命中词条记录已启用");
            } else {
                clearmissedTerms();
                GM_notification("未命中词条记录已禁用，所有记录已清空");
            }

            refreshMenuStates();
        });

        // 启用 + 有词条 ✅ 显示
        if (state.featureSet.enable_missedTerms) {
            const hasData = Object.keys(state.missedTerms).some(path =>
                Object.keys(state.missedTerms[path]).length > 0
            );

            if (hasData) {
                state.dynamicMenus.export = GM_registerMenuCommand("📥 导出未命中词条", exportMissedTermsHandler);
                state.dynamicMenus.clear = GM_registerMenuCommand("🗑️ 清空未命中词条", clearMissedTermsHandler);
            }
        }
    }

    // 导出“未命中词条”处理函数
    function exportMissedTermsHandler() {
        const blob = new Blob([JSON.stringify(state.missedTerms, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "未命中词条.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    // 清空“未命中词条”处理函数
    function clearMissedTermsHandler() {
        if (confirm("确定要清空所有未命中词条记录吗？")) {
            clearmissedTerms();
            GM_notification("未命中词条记录已清空");
            refreshMenuStates();
        }
    }

    /****************** 初始化执行 ******************/
    init();
})(window, document);
