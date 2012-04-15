/**
 * Copyright 2012 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.informantproject.core.weaving;

import java.util.List;

import org.informantproject.api.weaving.Mixin;
import org.objectweb.asm.Type;

/**
 * @author Trask Stalnaker
 * @since 0.5
 */
public class MixinMatcher {

    private final Mixin mixin;
    private final boolean targetTypeClassMatch;
    private final boolean alreadyImplementsMixin;
    private final boolean superClassMatch;

    public MixinMatcher(Mixin mixin, Type targetType, List<ParsedType> superTypes) {

        this.mixin = mixin;
        targetTypeClassMatch = isTypeMatch(targetType.getClassName());

        boolean superClassMatchLocal = false;
        boolean alreadyImplementsMixinLocal = false;
        for (ParsedType superType : superTypes) {
            if (isTypeMatch(superType.getClassName())) {
                superClassMatchLocal = true;
            }
            if (mixin.mixin().getName().equals(superType.getClassName())) {
                alreadyImplementsMixinLocal = true;
            }
            if (superClassMatchLocal && alreadyImplementsMixinLocal) {
                // nothing else to find out
                break;
            }
        }
        superClassMatch = superClassMatchLocal;
        alreadyImplementsMixin = alreadyImplementsMixinLocal;
    }

    public boolean isMatch() {
        return (targetTypeClassMatch || superClassMatch) && !alreadyImplementsMixin;
    }

    private boolean isTypeMatch(String className) {
        // currently only exact matching is supported
        return mixin.target().equals(className);
    }
}
