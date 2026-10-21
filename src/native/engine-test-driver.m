// Standalone test host: uses exactly the production C interface and system frameworks.
#import <Foundation/Foundation.h>
#include <stdio.h>
#include <stdlib.h>
extern void *timi_engine_create(const char *, const char *, char **);
extern char *timi_engine_call(void *, const char *, const char *, char **);
extern void timi_engine_destroy(void *);
extern void timi_engine_free_string(char *);

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 3) return 2;
        NSString *source = [NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[1]] encoding:NSUTF8StringEncoding error:NULL];
        if (!source) return 2;
        char *error = NULL;
        void *engine = timi_engine_create(source.UTF8String, argv[2], &error);
        if (!engine) { fprintf(stderr, "%s\n", error ?: "Engine initialization failed"); timi_engine_free_string(error); return 1; }
        char *line = NULL;
        size_t capacity = 0;
        int result = 0;
        while (getline(&line, &capacity, stdin) >= 0) {
            @autoreleasepool {
                NSData *data = [[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
                NSData *args = [NSJSONSerialization dataWithJSONObject:request[@"args"] ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:NULL];
                NSString *encoded = [[NSString alloc] initWithData:args encoding:NSUTF8StringEncoding];
                error = NULL;
                char *response = timi_engine_call(engine, [request[@"method"] UTF8String], encoded.UTF8String, &error);
                if (!response) { fprintf(stderr, "%s\n", error ?: "Engine call failed"); timi_engine_free_string(error); result = 1; break; }
                puts(response);
                fflush(stdout);
                timi_engine_free_string(response);
            }
        }
        free(line);
        timi_engine_destroy(engine);
        return result;
    }
}
