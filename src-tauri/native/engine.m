#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#include <sqlite3.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

// Every engine, including its SQLite handles and JS heap, has one owning thread.
// The context is independent of WKWebView and never receives renderer code.
@interface TIMIEngine : NSObject
@property(nonatomic, assign) JSGlobalContextRef context;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSValue *> *databases;
@property(nonatomic, assign) uint64_t nextDatabase;
@end
@implementation TIMIEngine
@end

static NSString *TimiString(JSContextRef context, JSValueRef value) {
    JSStringRef string = JSValueToStringCopy(context, value, NULL);
    if (!string) return nil;
    size_t capacity = JSStringGetMaximumUTF8CStringSize(string);
    char *buffer = malloc(capacity);
    if (!buffer) { JSStringRelease(string); return nil; }
    size_t length = JSStringGetUTF8CString(string, buffer, capacity);
    NSString *result = [[NSString alloc] initWithBytes:buffer length:length ? length - 1 : 0 encoding:NSUTF8StringEncoding];
    free(buffer);
    JSStringRelease(string);
    return result;
}

static JSValueRef TimiJSString(JSContextRef context, NSString *value) {
    JSStringRef string = JSStringCreateWithUTF8CString(value.UTF8String ?: "");
    JSValueRef result = JSValueMakeString(context, string);
    JSStringRelease(string);
    return result;
}

static NSDictionary *TimiFailure(NSString *message) {
    return @{ @"ok": @NO, @"error": message ?: @"Native storage failure" };
}

static NSDictionary *TimiSuccess(id value) {
    return @{ @"ok": @YES, @"value": value ?: NSNull.null };
}

static NSDictionary *TimiDatabaseError(sqlite3 *db) {
    return TimiFailure(db ? [NSString stringWithUTF8String:sqlite3_errmsg(db)] : @"Database is closed");
}

static NSDictionary *TimiQuery(sqlite3 *db, NSDictionary *request) {
    NSString *sql = request[@"sql"];
    NSString *mode = request[@"mode"];
    NSArray *params = request[@"params"];
    if (![sql isKindOfClass:NSString.class] || ![params isKindOfClass:NSArray.class]
        || ![@[@"all", @"get", @"run"] containsObject:mode]) return TimiFailure(@"Invalid query");
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(db, sql.UTF8String, -1, &statement, NULL) != SQLITE_OK) return TimiDatabaseError(db);
    if (!statement) return TimiFailure(@"Empty statement");
    NSDictionary *result = nil;
    if (sqlite3_bind_parameter_count(statement) != (int)params.count) result = TimiFailure(@"Incorrect parameter count");
    for (NSUInteger index = 0; !result && index < params.count; index++) {
        id value = params[index];
        int code;
        if (value == NSNull.null) code = sqlite3_bind_null(statement, (int)index + 1);
        else if ([value isKindOfClass:NSString.class]) {
            NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
            // NSString supplies a non-null pointer even for an empty string;
            // SQLite interprets a null pointer as SQL NULL regardless of length.
            code = sqlite3_bind_text(statement, (int)index + 1, [value UTF8String], (int)data.length, SQLITE_TRANSIENT);
        } else if ([value isKindOfClass:NSNumber.class]) {
            double number = [value doubleValue];
            if (!isfinite(number)) { result = TimiFailure(@"Invalid numeric parameter"); break; }
            code = floor(number) == number && fabs(number) <= 9007199254740991.0
                ? sqlite3_bind_int64(statement, (int)index + 1, [value longLongValue])
                : sqlite3_bind_double(statement, (int)index + 1, number);
        } else { result = TimiFailure(@"Invalid query parameter"); break; }
        if (code != SQLITE_OK) result = TimiDatabaseError(db);
    }
    NSMutableArray *rows = [NSMutableArray array];
    if (!result) {
        int code;
        while ((code = sqlite3_step(statement)) == SQLITE_ROW) {
            if ([mode isEqualToString:@"run"]) continue;
            NSMutableDictionary *row = [NSMutableDictionary dictionary];
            for (int column = 0; column < sqlite3_column_count(statement); column++) {
                NSString *name = [NSString stringWithUTF8String:sqlite3_column_name(statement, column)];
                id value;
                switch (sqlite3_column_type(statement, column)) {
                    case SQLITE_NULL: value = NSNull.null; break;
                    case SQLITE_INTEGER: {
                        sqlite3_int64 integer = sqlite3_column_int64(statement, column);
                        if (integer > 9007199254740991LL || integer < -9007199254740991LL) {
                            result = TimiFailure(@"Integer exceeds JavaScript safe range");
                            value = NSNull.null;
                        } else value = @(integer);
                        break;
                    }
                    case SQLITE_FLOAT: {
                        double number = sqlite3_column_double(statement, column);
                        if (!isfinite(number)) { result = TimiFailure(@"Invalid database number"); value = NSNull.null; }
                        else value = @(number);
                        break;
                    }
                    case SQLITE_TEXT:
                        value = [[NSString alloc] initWithBytes:sqlite3_column_text(statement, column)
                            length:sqlite3_column_bytes(statement, column) encoding:NSUTF8StringEncoding];
                        if (!value) { result = TimiFailure(@"Invalid database text"); value = NSNull.null; }
                        break;
                    default: result = TimiFailure(@"Unsupported database value"); value = NSNull.null; break;
                }
                row[name] = value;
                if (result) break;
            }
            if (result) break;
            [rows addObject:row];
            if ([mode isEqualToString:@"get"]) break;
        }
        if (!result && code != SQLITE_DONE && !(code == SQLITE_ROW && [mode isEqualToString:@"get"])) result = TimiDatabaseError(db);
        if (!result) {
            if ([mode isEqualToString:@"run"]) result = TimiSuccess(@{ @"changes": @(sqlite3_changes(db)), @"lastInsertRowid": @(sqlite3_last_insert_rowid(db)) });
            else if ([mode isEqualToString:@"get"]) result = TimiSuccess(rows.firstObject);
            else result = TimiSuccess(rows);
        }
    }
    // Finalize on every path. No failed bind/step can leave a live statement or lock.
    int finalized = sqlite3_finalize(statement);
    if (finalized != SQLITE_OK && [result[@"ok"] boolValue]) result = TimiDatabaseError(db);
    return result;
}

static NSDictionary *TimiNativeRequest(TIMIEngine *engine, NSDictionary *request) {
    NSString *operation = request[@"op"];
    if ([operation isEqualToString:@"uuid"]) return TimiSuccess(NSUUID.UUID.UUIDString.lowercaseString);
    if ([operation isEqualToString:@"open"]) {
        NSString *path = request[@"path"];
        if (![path isKindOfClass:NSString.class] || [path rangeOfString:@"\0"].location != NSNotFound) return TimiFailure(@"Invalid database path");
        sqlite3 *db = NULL;
        int code = sqlite3_open_v2(path.UTF8String, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL);
        if (code != SQLITE_OK) {
            NSDictionary *error = TimiDatabaseError(db);
            if (db) sqlite3_close(db);
            return error;
        }
        if ([request[@"exclusive"] boolValue]) {
            // SQLite's WAL shared-memory locks live as long as the connection.
            // Acquiring exclusive access therefore refuses an already-open old
            // Electron connection even while it is idle between checkpoints, and
            // keeps any later old/new process out until this connection closes.
            code = sqlite3_exec(db, "PRAGMA busy_timeout=3000; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;", NULL, NULL, NULL);
            if (code != SQLITE_OK) {
                NSDictionary *error = TimiDatabaseError(db);
                sqlite3_close(db);
                return error;
            }
        }
        NSNumber *identifier = @(++engine.nextDatabase);
        engine.databases[identifier] = [NSValue valueWithPointer:db];
        return TimiSuccess(identifier);
    }
    NSNumber *identifier = request[@"id"];
    if (![identifier isKindOfClass:NSNumber.class]) return TimiFailure(@"Invalid database handle");
    sqlite3 *db = [engine.databases[identifier] pointerValue];
    if (!db) return TimiFailure(@"Database is closed");
    if ([operation isEqualToString:@"close"]) {
        if (sqlite3_close(db) != SQLITE_OK) return TimiDatabaseError(db);
        [engine.databases removeObjectForKey:identifier];
        return TimiSuccess(nil);
    }
    if ([operation isEqualToString:@"exec"]) {
        NSString *sql = request[@"sql"];
        if (![sql isKindOfClass:NSString.class]) return TimiFailure(@"Invalid SQL");
        if (sqlite3_exec(db, sql.UTF8String, NULL, NULL, NULL) != SQLITE_OK) return TimiDatabaseError(db);
        return TimiSuccess(nil);
    }
    if ([operation isEqualToString:@"query"]) return TimiQuery(db, request);
    return TimiFailure(@"Unknown native operation");
}

static JSValueRef TimiNative(JSContextRef context, JSObjectRef function, JSObjectRef thisObject,
    size_t count, const JSValueRef arguments[], JSValueRef *exception) {
    @autoreleasepool {
        TIMIEngine *engine = (__bridge TIMIEngine *)JSObjectGetPrivate(JSContextGetGlobalObject(context));
        NSDictionary *response;
        @try {
            NSString *encoded = count == 1 ? TimiString(context, arguments[0]) : nil;
            id request = encoded ? [NSJSONSerialization JSONObjectWithData:[encoded dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] : nil;
            response = [request isKindOfClass:NSDictionary.class] ? TimiNativeRequest(engine, request) : TimiFailure(@"Invalid native request");
        } @catch (NSException *error) { response = TimiFailure(@"Native storage failure"); }
        NSData *json = [NSJSONSerialization dataWithJSONObject:response options:0 error:NULL];
        return TimiJSString(context, json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{\"ok\":false,\"error\":\"Native encoding failure\"}");
    }
}

static char *TimiCopyValue(JSContextRef context, JSValueRef value) {
    NSString *string = value ? TimiString(context, value) : nil;
    return strdup(string.UTF8String ?: "JavaScript engine failure");
}

static char *TimiCall(TIMIEngine *engine, const char *name, size_t count, const char **args, char **error) {
    JSContextRef context = engine.context;
    JSValueRef exception = NULL;
    JSStringRef key = JSStringCreateWithUTF8CString(name);
    JSValueRef value = JSObjectGetProperty(context, JSContextGetGlobalObject(context), key, &exception);
    JSStringRelease(key);
    JSObjectRef function = exception ? NULL : JSValueToObject(context, value, &exception);
    if (exception || !function || !JSObjectIsFunction(context, function)) {
        if (error) *error = TimiCopyValue(context, exception);
        return NULL;
    }
    JSValueRef arguments[2];
    for (size_t index = 0; index < count; index++) {
        JSStringRef string = JSStringCreateWithUTF8CString(args[index]);
        arguments[index] = JSValueMakeString(context, string);
        JSStringRelease(string);
    }
    JSValueRef result = JSObjectCallAsFunction(context, function, NULL, count, arguments, &exception);
    if (exception) { if (error) *error = TimiCopyValue(context, exception); return NULL; }
    return TimiCopyValue(context, result);
}

void timi_engine_destroy(void *pointer) {
    if (!pointer) return;
    @autoreleasepool {
        TIMIEngine *engine = (__bridge_transfer TIMIEngine *)pointer;
        for (NSValue *value in engine.databases.allValues) sqlite3_close_v2(value.pointerValue);
        [engine.databases removeAllObjects];
        if (engine.context) JSGlobalContextRelease(engine.context);
        engine.context = NULL;
    }
}

void *timi_engine_create(const char *source, const char *path, char **error) {
    @autoreleasepool {
        TIMIEngine *engine = [TIMIEngine new];
        engine.databases = [NSMutableDictionary dictionary];
        JSClassDefinition definition = kJSClassDefinitionEmpty;
        JSClassRef globalClass = JSClassCreate(&definition);
        engine.context = JSGlobalContextCreate(globalClass);
        JSClassRelease(globalClass);
        JSObjectSetPrivate(JSContextGetGlobalObject(engine.context), (__bridge void *)engine);
        void *pointer = (__bridge_retained void *)engine;
        JSStringRef name = JSStringCreateWithUTF8CString("__timiNative");
        JSObjectRef bridge = JSObjectMakeFunctionWithCallback(engine.context, name, TimiNative);
        JSObjectSetProperty(engine.context, JSContextGetGlobalObject(engine.context), name, bridge,
            kJSPropertyAttributeReadOnly | kJSPropertyAttributeDontDelete, NULL);
        JSStringRelease(name);
        JSStringRef script = JSStringCreateWithUTF8CString(source);
        JSValueRef exception = NULL;
        JSEvaluateScript(engine.context, script, NULL, NULL, 1, &exception);
        JSStringRelease(script);
        if (exception) {
            if (error) *error = TimiCopyValue(engine.context, exception);
            timi_engine_destroy(pointer);
            return NULL;
        }
        const char *args[] = { path };
        char *response = TimiCall(engine, "__timiInitialize", 1, args, error);
        NSDictionary *initialized = response ? [NSJSONSerialization JSONObjectWithData:
            [[NSString stringWithUTF8String:response] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] : nil;
        if (!initialized || ![initialized[@"ok"] boolValue]) {
            if (error && response) *error = response; else free(response);
            timi_engine_destroy(pointer);
            return NULL;
        }
        free(response);
        return pointer;
    }
}

char *timi_engine_call(void *pointer, const char *method, const char *args, char **error) {
    @autoreleasepool {
        const char *arguments[] = { method, args };
        return TimiCall((__bridge TIMIEngine *)pointer, "__timiDispatch", 2, arguments, error);
    }
}

void timi_engine_free_string(char *value) { free(value); }
