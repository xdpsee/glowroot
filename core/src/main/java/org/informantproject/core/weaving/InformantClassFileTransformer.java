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

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.security.ProtectionDomain;
import java.util.List;

import org.informantproject.api.Metric;
import org.informantproject.api.PluginServices;
import org.informantproject.api.TraceMetric;
import org.informantproject.api.weaving.Mixin;
import org.informantproject.core.configuration.PluginDescriptor;
import org.informantproject.core.configuration.Plugins;
import org.informantproject.core.trace.MetricImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.base.Ticker;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.Lists;
import com.google.inject.Inject;

/**
 * @author Trask Stalnaker
 * @since 0.5
 */
public class InformantClassFileTransformer implements ClassFileTransformer {

    private static final Logger logger = LoggerFactory
            .getLogger(InformantClassFileTransformer.class);

    private final PluginServices pluginServices;
    private final List<Mixin> mixins;
    private final List<Advice> advisors;

    private final LoadingCache<ClassLoader, Weaver> weaver = CacheBuilder.newBuilder().weakKeys()
            .build(new CacheLoader<ClassLoader, Weaver>() {
                @Override
                public Weaver load(ClassLoader loader) throws Exception {
                    return new Weaver(mixins, advisors, loader);
                }
            });

    private final Metric metric;

    @Inject
    public InformantClassFileTransformer(PluginServices pluginServices, Ticker ticker) {
        this.pluginServices = pluginServices;
        List<Mixin> mixins = Lists.newArrayList();
        List<Advice> advisors = Lists.newArrayList();
        for (PluginDescriptor plugin : Plugins.getPackagedPluginDescriptors()) {
            mixins.addAll(plugin.getMixins());
            advisors.addAll(plugin.getAdvisors());
        }
        for (PluginDescriptor plugin : Plugins.getInstalledPluginDescriptors()) {
            mixins.addAll(plugin.getMixins());
            advisors.addAll(plugin.getAdvisors());
        }
        this.mixins = ImmutableList.copyOf(mixins);
        this.advisors = ImmutableList.copyOf(advisors);
        metric = new MetricImpl("informant weaving", ticker);
    }

    public byte[] transform(ClassLoader loader, String className, Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain, byte[] bytes) throws IllegalClassFormatException {

        return transform$informant$metric$informant$weaving$0(loader, className, protectionDomain,
                bytes);
    }

    // weird method name is following "metric marker" method naming
    private byte[] transform$informant$metric$informant$weaving$0(ClassLoader loader,
            String className,
            ProtectionDomain protectionDomain, byte[] bytes) {

        TraceMetric traceMetric = pluginServices.startMetric(metric);
        try {
            byte[] transformedBytes = weaver.getUnchecked(loader).weave(bytes, protectionDomain);
            if (transformedBytes != null && transformedBytes != bytes) {
                logger.debug("transform(): transformed {}", className);
            }
            return transformedBytes;
        } finally {
            pluginServices.endMetric(traceMetric);
        }
    }
}
