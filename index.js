'use strict';

var utils = require("./utils");
var cheerio = require("cheerio");
var log = require("npmlog");
var logger = require('./logger');
const { getRandomBytesSync } = require("ethereum-cryptography/random");

var checkVerified = null;

var defaultLogRecordSize = 100;
log.maxRecordSize = defaultLogRecordSize;

function setOptions(globalOptions, options) {
    Object.keys(options).map(function(key) {
        switch (key) {
            case 'pauseLog':
                if (options.pauseLog) log.pause();
                break;
            case 'online':
                globalOptions.online = Boolean(options.online);
                break;
            case 'logLevel':
                log.level = options.logLevel;
                globalOptions.logLevel = options.logLevel;
                break;
            case 'logRecordSize':
                log.maxRecordSize = options.logRecordSize;
                globalOptions.logRecordSize = options.logRecordSize;
                break;
            case 'selfListen':
                globalOptions.selfListen = Boolean(options.selfListen);
                break;
            case 'listenEvents':
                globalOptions.listenEvents = Boolean(options.listenEvents);
                break;
            case 'pageID':
                globalOptions.pageID = options.pageID.toString();
                break;
            case 'updatePresence':
                globalOptions.updatePresence = Boolean(options.updatePresence);
                break;
            case 'forceLogin':
                globalOptions.forceLogin = Boolean(options.forceLogin);
                break;
            case 'userAgent':
                globalOptions.userAgent = options.userAgent;
                break;
            case 'autoMarkDelivery':
                globalOptions.autoMarkDelivery = Boolean(options.autoMarkDelivery);
                break;
            case 'autoMarkRead':
                globalOptions.autoMarkRead = Boolean(options.autoMarkRead);
                break;
            case 'listenTyping':
                globalOptions.listenTyping = Boolean(options.listenTyping);
                break;
            case 'proxy':
                if (typeof options.proxy != "string") {
                    delete globalOptions.proxy;
                    utils.setProxy();
                } else {
                    globalOptions.proxy = options.proxy;
                    utils.setProxy(globalOptions.proxy);
                }
                break;
            case 'autoReconnect':
                globalOptions.autoReconnect = Boolean(options.autoReconnect);
                break;
            case 'emitReady':
                globalOptions.emitReady = Boolean(options.emitReady);
                break;
            default:
                log.warn("setOptions", "Unrecognized option given to setOptions: " + key);
                break;
        }
    });
}

function buildAPI(globalOptions, html, jar) {
    var maybeCookie = jar.getCookies("https://www.facebook.com").filter(function(val) {
        return val.cookieString().split("=")[0] === "c_user";
    });

    if (maybeCookie.length === 0) throw { error: "Appstate - Cookie Của Bạn Đã Bị Lỗi, Hãy Thay Cái Mới, Hoặc Vô Trình Duyệt Ẩn Danh Rồi Đăng Nhập Và Thử Lại !" };

    if (html.indexOf("/checkpoint/block/?next") > -1) log.warn("login", "Phát Hiện CheckPoint - Không Đăng Nhập Được, Hãy Thử Logout Rồi Login Và Lấy Lại Appstate - Cookie !");

    var userID = maybeCookie[0].cookieString().split("=")[1].toString();
    logger(`Đăng Nhập Tại ID: ${userID}`, "[ FCA-DONGDEV ]");
    process.env['UID'] = userID;
    try {
        clearInterval(checkVerified);
    } catch (e) {
        console.log(e);
    }

    var clientID = (Math.random() * 2147483648 | 0).toString(16);

    let oldFBMQTTMatch = html.match(/irisSeqID:"(.+?)",appID:219994525426954,endpoint:"(.+?)"/);
    let mqttEndpoint = null;
    let region = null;
    let irisSeqID = null;
    var noMqttData = null;

    if (oldFBMQTTMatch) {
        irisSeqID = oldFBMQTTMatch[1];
        mqttEndpoint = oldFBMQTTMatch[2];
        region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
        logger(`Vùng Của Tài Khoản Là: ${region}`, "[ FCA-DONGDEV ]");
    } else {
        let newFBMQTTMatch = html.match(/{"app_id":"219994525426954","endpoint":"(.+?)","iris_seq_id":"(.+?)"}/);
        if (newFBMQTTMatch) {
            irisSeqID = newFBMQTTMatch[2];
            mqttEndpoint = newFBMQTTMatch[1].replace(/\\\//g, "/");
            region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
            logger(`Vùng Của Tài Khoản Là:  ${region}`, "[ FCA-DONGDEV ]");
        } else {
            let legacyFBMQTTMatch = html.match(/(\["MqttWebConfig",\[\],{fbid:")(.+?)(",appID:219994525426954,endpoint:")(.+?)(",pollingEndpoint:")(.+?)(3790])/);
            if (legacyFBMQTTMatch) {
                mqttEndpoint = legacyFBMQTTMatch[4];
                region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
                log.warn("login", `Cannot get sequence ID with new RegExp. Fallback to old RegExp (without seqID)...`);
                logger(`Vùng Của Tài Khoản Là: ${region}`, "[ FCA-DONGDEV ]");
                logger("login", `[Unused] Polling endpoint: ${legacyFBMQTTMatch[6]}`);
            } else {
                log.warn("login", "Không Thể Lấy ID Hãy Thử Lại !");
                noMqttData = html;
            }
        }
    }

    // All data available to api functions
    var ctx = {
        userID: userID,
        jar: jar,
        clientID: clientID,
        globalOptions: globalOptions,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        mqttClient: undefined,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint,
        region,
        firstListen: true
    };

    var api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: function getAppState() {
            return utils.getAppState(jar);
        }
    };

    if (noMqttData) api["htmlData"] = noMqttData;

    const apiFuncNames = [
        'addExternalModule',
        'addUserToGroup',
        'changeAdminStatus',
        'changeArchivedStatus',
        'changeBio',
        'changeBlockedStatus',
        'changeGroupImage',
        'changeNickname',
        'changeThreadColor',
        'changeThreadEmoji',
        'createNewGroup',
        'createPoll',
        'deleteMessage',
        'deleteThread',
        'forwardAttachment',
        'getCurrentUserID',
        'getEmojiUrl',
        'getFriendsList',
        'getThreadHistory',
        'getThreadInfo',
        'getThreadList',
        'getThreadPictures',
        'getUserID',
        'getUserInfo',
        'handleMessageRequest',
        'listenMqtt',
        'logout',
        'markAsDelivered',
        'markAsRead',
        'markAsReadAll',
        'markAsSeen',
        'muteThread',
        'removeUserFromGroup',
        'resolvePhotoUrl',
        'searchForThread',
        'sendMessage',
        'sendTypingIndicator',
        'setMessageReaction',
        'setTitle',
        'threadColors',
        'unsendMessage',
        'unfriend',
        'setPostReaction',
        'handleFriendRequest',
        'handleMessageRequest',

        // HTTP
        'httpGet',
        'httpPost',
        'httpPostFormData',

        // Deprecated features
        "getThreadListDeprecated",
        'getThreadHistoryDeprecated',
        'getThreadInfoDeprecated',
    ];

    var defaultFuncs = utils.makeDefaults(html, userID, ctx);

    // Load all api functions in a loop
    apiFuncNames.map(v => api[v] = require('./src/' + v)(defaultFuncs, api, ctx));

    return [ctx, defaultFuncs, api];
}

function makeLogin(jar, email, password, loginOptions, callback, prCallback) {
    return function(res) {
        var html = res.body;
        var $ = cheerio.load(html);
        var arr = [];

        // This will be empty, but just to be sure we leave it
        $("#login_form input").map((i, v) => arr.push({ val: $(v).val(), name: $(v).attr("name") }));

        arr = arr.filter(function(v) {
            return v.val && v.val.length;
        });

        var form = utils.arrToForm(arr);
        form.lsd = utils.getFrom(html, "[\"LSD\",[],{\"token\":\"", "\"}");
        form.lgndim = Buffer.from("{\"w\":1440,\"h\":900,\"aw\":1440,\"ah\":834,\"c\":24}").toString('base64');
        form.email = email;
        form.pass = password;
        form.default_persistent = '0';
        form.lgnrnd = utils.getFrom(html, "name=\"lgnrnd\" value=\"", "\"");
        form.locale = 'en_US';
        form.timezone = '240';
        form.lgnjs = ~~(Date.now() / 1000);


        // Getting cookies from the HTML page... (kill me now plz)
        // we used to get a bunch of cookies in the headers of the response of the
        // request, but FB changed and they now send those cookies inside the JS.
        // They run the JS which then injects the cookies in the page.
        // The "solution" is to parse through the html and find those cookies
        // which happen to be conveniently indicated with a _js_ in front of their
        // variable name.
        //
        // ---------- Very Hacky Part Starts -----------------
        var willBeCookies = html.split("\"_js_");
        willBeCookies.slice(1).map(function(val) {
            var cookieData = JSON.parse("[\"" + utils.getFrom(val, "", "]") + "]");
            jar.setCookie(utils.formatCookie(cookieData, "facebook"), "https://www.facebook.com");
        });
        // ---------- Very Hacky Part Ends -----------------

        logger("Đang Đăng Nhập...", "[ FCA-DONGDEV ]");
        return utils
            .post("https://www.facebook.com/login/device-based/regular/login/?login_attempt=1&lwv=110", jar, form, loginOptions)
            .then(utils.saveCookies(jar))
            .then(function(res) {
                var headers = res.headers;
                if (!headers.location) throw { error: "Sai Mật Khẩu Hoặc Tài Khoản !" };

                // This means the account has login approvals turned on.
                if (headers.location.indexOf('https://www.facebook.com/checkpoint/') > -1) {
                    logger("Bạn Đang Bật 2 Bảo Mật !", "[ FCA-DONGDEV ]");
                    var nextURL = 'https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php';

                    return utils
                        .get(headers.location, jar, null, loginOptions)
                        .then(utils.saveCookies(jar))
                        .then(function(res) {
                            var html = res.body;
                            // Make the form in advance which will contain the fb_dtsg and nh
                            var $ = cheerio.load(html);
                            var arr = [];
                            $("form input").map((i, v) => arr.push({ val: $(v).val(), name: $(v).attr("name") }));

                            arr = arr.filter(function(v) {
                                return v.val && v.val.length;
                            });

                            var form = utils.arrToForm(arr);
                            if (html.indexOf("checkpoint/?next") > -1) {
                                setTimeout(() => {
                                    checkVerified = setInterval((_form) => {}, 5000, {
                                        fb_dtsg: form.fb_dtsg,
                                        jazoest: form.jazoest,
                                        dpr: 1
                                    });
                                }, 2500);
                                throw {
                                    error: 'login-approval',
                                    continue: function submit2FA(code) {
                                        form.approvals_code = code;
                                        form['submit[Continue]'] = $("#checkpointSubmitButton").html(); //'Continue';
                                        var prResolve = null;
                                        var prReject = null;
                                        var rtPromise = new Promise(function(resolve, reject) {
                                            prResolve = resolve;
                                            prReject = reject;
                                        });
                                        if (typeof code == "string") {
                                            utils
                                                .post(nextURL, jar, form, loginOptions)
                                                .then(utils.saveCookies(jar))
                                                .then(function(res) {
                                                    var $ = cheerio.load(res.body);
                                                    var error = $("#approvals_code").parent().attr("data-xui-error");
                                                    if (error) {
                                                        throw {
                                                            error: 'login-approval',
                                                            errordesc: "Invalid 2FA code.",
                                                            lerror: error,
                                                            continue: submit2FA
                                                        };
                                                    }
                                                })
                                                .then(function() {
                                                    // Use the same form (safe I hope)
                                                    delete form.no_fido;
                                                    delete form.approvals_code;
                                                    form.name_action_selected = 'dont_save'; //'save_device';

                                                    return utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
                                                })
                                                .then(function(res) {
                                                    var headers = res.headers;
                                                    if (!headers.location && res.body.indexOf('Review Recent Login') > -1) throw { error: "Something went wrong with login approvals." };

                                                    var appState = utils.getAppState(jar);

                                                    if (callback === prCallback) {
                                                        callback = function(err, api) {
                                                            if (err) return prReject(err);
                                                            return prResolve(api);
                                                        };
                                                    }

                                                    // Simply call loginHelper because all it needs is the jar
                                                    // and will then complete the login process
                                                    return loginHelper(appState, email, password, loginOptions, callback);
                                                })
                                                .catch(function(err) {
                                                    // Check if using Promise instead of callback
                                                    if (callback === prCallback) prReject(err);
                                                    else callback(err);
                                                });
                                        } else {
                                            utils
                                                .post("https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php", jar, form, loginOptions, null, { "Referer": "https://www.facebook.com/checkpoint/?next" })
                                                .then(utils.saveCookies(jar))
                                                .then(res => {
                                                    try {
                                                        JSON.parse(res.body.replace(/for\s*\(\s*;\s*;\s*\)\s*;\s*/, ""));
                                                    } catch (ex) {
                                                        clearInterval(checkVerified);
                                                        logger("Xác Nhận Từ Trình Duyệt, Đang Đăng Nhập...", "[ FCA-DONGDEV ]");
                                                        if (callback === prCallback) {
                                                            callback = function(err, api) {
                                                                if (err) return prReject(err);
                                                                return prResolve(api);
                                                            };
                                                        }
                                                        return loginHelper(utils.getAppState(jar), email, password, loginOptions, callback);
                                                    }
                                                })
                                                .catch(ex => {
                                                    log.error("login", ex);
                                                    if (callback === prCallback) prReject(ex);
                                                    else callback(ex);
                                                });
                                        }
                                        return rtPromise;
                                    }
                                };
                            } else {
                                if (!loginOptions.forceLogin) throw { error: "Couldn't login. Facebook might have blocked this account. Please login with a browser or enable the option 'forceLogin' and try again." };

                                if (html.indexOf("Suspicious Login Attempt") > -1) form['submit[This was me]'] = "This was me";
                                else form['submit[This Is Okay]'] = "This Is Okay";

                                return utils
                                    .post(nextURL, jar, form, loginOptions)
                                    .then(utils.saveCookies(jar))
                                    .then(function() {
                                        // Use the same form (safe I hope)
                                        form.name_action_selected = 'save_device';

                                        return utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
                                    })
                                    .then(function(res) {
                                        var headers = res.headers;

                                        if (!headers.location && res.body.indexOf('Review Recent Login') > -1) throw { error: "Something went wrong with review recent login." };

                                        var appState = utils.getAppState(jar);

                                        // Simply call loginHelper because all it needs is the jar
                                        // and will then complete the login process
                                        return loginHelper(appState, email, password, loginOptions, callback);
                                    })
                                    .catch(e => callback(e));
                            }
                        });
                }

                return utils.get('https://www.facebook.com/', jar, null, loginOptions).then(utils.saveCookies(jar));
            });
    };
}

  function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * 
 charactersLength));
   }
   return result;
}

// Helps the login
async function loginHelper(appState, email, password, globalOptions, callback, prCallback) {
    var mainPromise = null;
    var jar = utils.getJar();

    // If we're given an appState we loop through it and save each cookie
    // back into the jar.
try { 
    if (appState) {
        
        //const readline = require("readline");
        //const chalk = require("chalk");
        var logger = require('./logger');
        //const figlet = require("figlet");
        const fs = require("fs-extra");
       // const os = require("os");
        //const { execSync } = require('child_process');
        //var { readFileSync } = require('fs-extra');
        // let rl = readline.createInterface({
        // input: process.stdin,
        // output: process.stdout,
        // prompt: chalk.hex('#00CCCC').bold('[FCA-DONGDEV] • ')
        // });
        // let type = {
        //     1: {    
        //         "name": "Tạo Mật Khẩu Cho Appstate",
        //          onRun: async function() {
        //             try {
        //                 rl.question("Hãy Nhập Mật Khẩu Bạn Muốn Đặt Cho Appstate !", (answer) => {
        //                     console.log("Được Rồi Mật Khẩu Của Bạn Là: " + answer + ", Bạn Hãy Nhớ Kĩ Nhé !");
        //                 process.env["FBKEY"] = answer;
        //                     fs.writeFile('../.env', `FBKEY=${answer}`, function (err) {
        //                         if (err) {
        //                             logger("Tạo File ENV Thất Bại !", "[ FCA-DONGDEV ]")
        //                             rl.pause();
        //                         }
        //                         else logger("Tạo Thành Công File ENV !","[ FCA-DONGDEV ]")
        //                         rl.pause();
        //                     });
        //                 })
        //             }
        //             catch (e) {
        //                 console.log(e);
        //                 logger("Đã Có Lỗi Khi Đang Try Tạo Ra Câu Hỏi =))", "[ FCA-DONGDEV ]");
        //                 rl.pause();
        //             }
        //         }
        //     },
        //     2: {
        //         "name": "Tiếp Tục Chạy Fca Mà Không Cần Mã Hóa AppState",
        //          onRun: async function () {
        //             rl.pause();
        //         }
        //     },
        //     3: {
        //         "name": "Đổi Mật Khẩu AppState (Comming Soon..)", 
        //         onRun: async function () {
        //             console.log(chalk.red.bold("Đã bảo là comming soon rồi mà >:v"));                        
        //         }
        //     }
        // }
        // const localbrand = JSON.parse(readFileSync('./package.json')).name;
        // const localbrand2 = JSON.parse(readFileSync('./node_modules/fca-horizon-remake/package.json')).version;
        // var axios = require('axios');   
        //     axios.get('https://raw.githubusercontent.com/HarryWakazaki/Fca-Horizon-Remake/main/package.json').then(async (res) => {
        //         if (localbrand.toUpperCase() == 'HORIZON') {
        //             console.group(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))  
        //                 console.log(chalk.bold.hex('#00FFCC')("[</>]") + chalk.bold.yellow(' => ') + "Hệ Điều Hành: " + chalk.bold.red(os.type()));
        //                 console.log(chalk.bold.hex('#00FFCC')("[</>]") + chalk.bold.yellow(' => ') + "Thông Tin Máy: " + chalk.bold.red(os.version()));
        //                 console.log(chalk.bold.hex('#00FFCC')("[</>]") + chalk.bold.yellow(' => ') + "Phiên Bản Hiện Tại: " + chalk.bold.red(localbrand2));
        //                 console.log(chalk.bold.hex('#00FFCC')("[</>]") + chalk.bold.yellow(' => ')  + "Phiên Bản Mới Nhất: " + chalk.bold.red(res.data.version));
        //             console.groupEnd();
        //         }
        //     else {
        //         console.clear();
        //         console.log(figlet.textSync('TeamHorizon', {font: 'ANSI Shadow',horizontalLayout: 'default',verticalLayout: 'default',width: 0,whitespaceBreak: true }))
        //         console.log(chalk.hex('#9966CC')(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
        //     }
        // });
        try {
            if (fs.existsSync('./../.env')) {
                require('dotenv').config({ path: './../.env' });
            }
            else {
                fs.writeFileSync('./../.env', ``);
                require('dotenv').config({ path: './../.env' });
            }
        }
        catch (e) {
            console.log(e);
            process.exit(1);
        }
        
        if (!process.env['FBKEY']) {
            try {
            var ans = makeid(49)
                //var ans = getRandomBytesSync(32)
                    process.env["FBKEY"] = ans;
                        fs.writeFile('./../.env', `FBKEY=${ans}`, function (err) {
                            if (err) {
                            logger("Tạo File ENV Thất Bại !", "[ FCA-DONGDEV ]");
                    }
                else logger("Tạo Thành Công File ENV !","[ FCA-DONGDEV ]")
        }); 
    }
    catch (e) {
        console.log(e);
        logger("Đã Có Lỗi Khi Đang Try Tạo Random Password =))", "[ FCA-DONGDEV ]");
    }
}
    
    if (process.env['FBKEY']) {
        try {
            appState = JSON.stringify(appState);
            if (appState.includes('[')) {
                logger('Chưa Sẵn Sàng Để Decrypt Appstate !', '[ FCA-DONGDEV ]');
            } else {
                try {
                    appState = JSON.parse(appState);
                    var StateCrypt = require('./StateCrypt');
                    var keyy = process.env['FBKEY'];
                    appState = StateCrypt.decryptState(appState, process.env['FBKEY']);
                    logger('Decrypt Appstate Thành Công !', '[ FCA-DONGDEV ]');
                    logger('Password AppState là :' + keyy, '[ PASS-FCAD ]');
                }
                catch (e) {
                    logger('Thay AppState Đi !', '[ FCA-DONGDEV ]');
                }
            }
        }
        catch (e) {
            console.log(e);
        }
    }  
    try {
        appState = JSON.parse(appState);
    }
    catch (e) {
        try {
            appState = appState;
        }
        catch (e) {
            return logger('Thay AppState Đi !', '[ FCA-DONGDEV ]')
        }
    }
    try { 
    appState.map(function(c) {
        var str = c.key + "=" + c.value + "; expires=" + c.expires + "; domain=" + c.domain + "; path=" + c.path + ";";
        jar.setCookie(str, "http://" + c.domain);
    });

    // Load the main page.
    mainPromise = utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true }).then(utils.saveCookies(jar));
} catch (e) {
    return logger('Thay AppState Đi !', '[ FCA-DONGDEV ]')
}
} else {
        // Open the main page, then we login with the given credentials and finally
        // load the main page again (it'll give us some IDs that we need)
        mainPromise = utils
            .get("https://www.facebook.com/", null, null, globalOptions, { noRef: true })
            .then(utils.saveCookies(jar))
            .then(makeLogin(jar, email, password, globalOptions, callback, prCallback))
            .then(function() {
                return utils.get('https://www.facebook.com/', jar, null, globalOptions).then(utils.saveCookies(jar));
            });
        }
    } catch (e) {
        console.log(e);
    }
            var ctx = null;
            var _defaultFuncs = null;
            var api = null;
        
            mainPromise = mainPromise
                .then(function(res) {
                    // Hacky check for the redirection that happens on some ISPs, which doesn't return statusCode 3xx
                    var reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
                    var redirect = reg.exec(res.body);
                    if (redirect && redirect[1]) return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
                    return res;
                })
                .then(function(res) {
                    var html = res.body;
                    var stuff = buildAPI(globalOptions, html, jar);
                    ctx = stuff[0];
                    _defaultFuncs = stuff[1];
                    api = stuff[2];
                    return res;
                });
        
            // given a pageID we log in as a page
            if (globalOptions.pageID) {
                mainPromise = mainPromise
                    .then(function() {
                        return utils.get('https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox', ctx.jar, null, globalOptions);
                    })
                    .then(function(resData) {
                        var url = utils.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");').split('\\').join('');
                        url = url.substring(0, url.length - 1);
                        return utils.get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
                    });
            }
        
        
                        // At the end we call the callback or catch an exception
            mainPromise
                .then(function() {
                    logger('Hoàn Thành Quá Trình Đăng Nhập !', "[ FCA-DONGDEV ]");
                        logger('Auto Check Update ...', "[ FCA-DONGDEV ]");
                            //!---------- Auto Check, Update START -----------------!//
                        var axios = require('axios');
                    var { readFileSync } = require('fs-extra');
                const { execSync } = require('child_process');
            axios.get('https://pastebin.com/raw/u09fqR8C').then(async (res) => {
                const localbrand = JSON.parse(readFileSync('./node_modules/fca-dongdev/package.json')).version;
                    if (localbrand != res.data.version) {
                        log.warn("[ FCA-DONGDEV ] •",`Phiên Bản Mới Đã Được Publish: ${JSON.parse(readFileSync('./node_modules/fca-dongdev/package.json')).version} => ${res.data.version}`);
                        log.warn("[ FCA-DONGDEV ] •",`Tiến Hành Tự Động Cập Nhật Lên Phiên Bản Mới Nhất !`);
                            try {
                                execSync('npm install fca-dongdev@latest', { stdio: 'inherit' });
                                logger("Nâng Cấp Phiên Bản Thành Công!","[ FCA-DONGDEV ]")
                                logger('Đang Khởi Động Lại...', '[ FCA-DONGDEV ]');
                                await new Promise(resolve => setTimeout(resolve,5*1000));
                                console.clear();process.exit(1);
                            }
                        catch (err) {
                            log.warn('Lỗi Auto Update ! ' + err);
                            
                                // <= Start Submit The Error To The Api => //
        
                                /*try {
                                    var { data } = await axios.get(`https://bank-sv-4.duongduong216.repl.co/fcaerr?error=${encodeURI(err)}&senderID=${encodeURI(process.env['UID'] || "IDK")}&DirName=${encodeURI(__dirname)}`);
                                    if (data) {
                                        logger.onLogger('Đã Gửi Báo Cáo Lỗi Tới Server !', '[ FCA-DONGDEV ]'," #FF0000")
                                    }
                                }
                                catch (e) {
                                    logger.onLogger('Đã Xảy Ra Lỗi Khi Cố Gửi Lỗi Đến Server', '[ FCA-DONGDEV ]'," #FF0000")
                                }*/
                            
                        }
                    }
                        else { 
                            logger(`Bạn Hiện Đang Sử Dụng Phiên Bản: ` + localbrand + ' !', "[ FCA-DONGDEV ]"); 
                            logger(`Chúc Bạn Một Ngày Tốt Lành !`)     
                            await new Promise(resolve => setTimeout(resolve, 5*1000));
                            callback(null, api);
                        }
                    });
                }).catch(function(e) {
                    log.error("login", e.error || e);
                callback(e);
            });
            //!---------- Auto Check, Update END -----------------!//
}

function login(loginData, options, callback) {
    if (utils.getType(options) === 'Function' || utils.getType(options) === 'AsyncFunction') {
        callback = options;
        options = {};
    }

    var globalOptions = {
        selfListen: false,
        listenEvents: true,
        listenTyping: false,
        updatePresence: false,
        forceLogin: false,
        autoMarkDelivery: false,
        autoMarkRead: false,
        autoReconnect: true,
        logRecordSize: defaultLogRecordSize,
        online: false,
        emitReady: false,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18"
    };

    //! bằng 1 cách nào đó tắt online sẽ đánh lừa được facebook :v
    //! phải có that có this chứ :v

    setOptions(globalOptions, options);

    var prCallback = null;
    if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
        var rejectFunc = null;
        var resolveFunc = null;
        var returnPromise = new Promise(function(resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });
        prCallback = function(error, api) {
            if (error) return rejectFunc(error);
            return resolveFunc(api);
        };
        callback = prCallback;
    }
    loginHelper(loginData.appState, loginData.email, loginData.password, globalOptions, callback, prCallback);
    return returnPromise;
}

module.exports = login;
