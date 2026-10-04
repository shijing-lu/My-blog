#include <jni.h>
#include <node.h>
#include <android/log.h>
#include <unistd.h>
#include <thread>
#include <vector>
#include <cstring>

static void forwardLog(int fd) {
    char buffer[1024]; ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[count] = 0;
        __android_log_write(ANDROID_LOG_INFO, "ByqxNode", buffer);
    }
    close(fd);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_byqx_blog_MainActivity_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    int output[2], errors[2];
    if (pipe(output) == 0) { dup2(output[1], STDOUT_FILENO); close(output[1]); std::thread(forwardLog, output[0]).detach(); }
    if (pipe(errors) == 0) { dup2(errors[1], STDERR_FILENO); close(errors[1]); std::thread(forwardLog, errors[0]).detach(); }
    setvbuf(stdout, nullptr, _IONBF, 0); setvbuf(stderr, nullptr, _IONBF, 0);
    int argc = env->GetArrayLength(arguments);
    std::vector<std::string> strings; size_t bytes = 0;
    for (int i = 0; i < argc; ++i) {
        auto value = (jstring) env->GetObjectArrayElement(arguments, i);
        const char* chars = env->GetStringUTFChars(value, nullptr);
        strings.emplace_back(chars); bytes += strings.back().size() + 1;
        env->ReleaseStringUTFChars(value, chars); env->DeleteLocalRef(value);
    }
    std::vector<char> buffer(bytes); std::vector<char*> argv(argc);
    char* next = buffer.data();
    for (int i = 0; i < argc; ++i) { argv[i] = next; memcpy(next, strings[i].c_str(), strings[i].size() + 1); next += strings[i].size() + 1; }
    return node::Start(argc, argv.data());
}
